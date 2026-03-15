//! OCR booking extraction tool — wraps the Python OCR service as a rig [`Tool`].
//!
//! The LLM calls this tool when the user provides a booking screenshot/image path
//! and wants extracted travel details.
//!
//! ## Pipeline
//! 1. The Python OCR service runs Tesseract on the image and returns raw text.
//! 2. This tool sends that raw text to the Featherless LLM for cleanup (fixing
//!    garbled characters, restoring reading order) before returning to the agent.
//! 3. If the OCR result contains a `comparison_query_json`, the scraper is called
//!    automatically and a structured trip-check verdict is appended to the output.
//!    This makes the pipeline deterministic — the LLM never decides whether to call
//!    the scraper; it always happens when enough data is available.

pub mod client;

use std::sync::Arc;

use rig::{completion::ToolDefinition, tool::Tool};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::tools::scraper::client::ScraperClient;
use client::OcrClient;

const OCR_CLEANUP_SYSTEM_PROMPT: &str = "\
You are a precise travel-document OCR corrector.
You receive raw text extracted by Tesseract OCR from a travel booking screenshot.
The text may contain garbled characters, merged words, broken lines, or noise.

Your job:
1. Fix OCR errors (e.g. \"0TP\" → \"OTP\", \"WlzzAlr\" → \"Wizz Air\", \"1 Apr1l\" → \"1 April\").
2. Restore the logical reading order.
3. Preserve ALL information: flight numbers, IATA codes, dates, prices, airline names, \
hotel names, booking references, passenger counts. Do NOT remove or omit anything.
4. Output only the corrected plain text. No markdown, no headings, no commentary.
5. If a value is genuinely unreadable, write [UNREADABLE] in its place.

CRITICAL — dates and numbers:
- Digits are the most common OCR errors: 0/O, 1/I/l, 2/Z, 5/S, 6/b, 8/B
- Reproduce dates EXACTLY as they appear in the raw text. Do NOT guess or infer a date.
- If a date looks wrong (e.g. month 13, day 32), flag it with [CHECK DATE] but still copy it.";

/// Arguments the LLM passes when invoking the extract_booking_info tool.
#[derive(Debug, Deserialize)]
pub struct ExtractBookingArgs {
    pub session_id: String,
    pub image_path: String,
}

/// Serializable output returned to the LLM after tool execution.
#[derive(Debug, Serialize)]
pub struct ExtractBookingOutput {
    pub summary: String,
    pub comparison_query_json: Option<String>,
    /// Deterministic trip-check result: verdict + live alternatives from the scraper.
    /// Present when OCR extracted enough data (origin, destination, date) and the
    /// scraper returned results. The LLM must present this verbatim to the user.
    pub trip_check: Option<String>,
}

/// Errors that can occur during OCR tool execution.
#[derive(Debug, thiserror::Error)]
pub enum OcrToolError {
    #[error("OCR call failed: {0}")]
    Rpc(#[from] AppError),
    #[error("LLM cleanup request failed: {0}")]
    Http(#[from] reqwest::Error),
}

/// rig tool that extracts booking info from screenshot images.
#[derive(Clone)]
pub struct OcrTool {
    client:         Arc<OcrClient>,
    scraper_client: Arc<ScraperClient>,
    api_key:        String,
    base_url:       String,
    model:          String,
    http:           reqwest::Client,
}

impl OcrTool {
    pub fn new(
        client: Arc<OcrClient>,
        scraper_client: Arc<ScraperClient>,
        api_key: String,
        base_url: String,
        model: String,
        http: reqwest::Client,
    ) -> Self {
        Self {
            client,
            scraper_client,
            api_key,
            base_url,
            model,
            http,
        }
    }

    async fn llm_clean(&self, raw_ocr: &str) -> Result<String, OcrToolError> {
        let payload = serde_json::json!({
            "model": self.model,
            "messages": [
                {"role": "system", "content": OCR_CLEANUP_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": format!(
                        "Here is the raw OCR output from a travel booking screenshot. \
                         Please clean and correct it:\n\n---\n{raw_ocr}\n---"
                    )
                }
            ],
            "max_tokens": 1024,
            "temperature": 0.0
        });

        let resp = self
            .http
            .post(format!("{}/chat/completions", self.base_url))
            .bearer_auth(&self.api_key)
            .json(&payload)
            .send()
            .await?;

        let data: serde_json::Value = resp.json().await?;
        let cleaned = data["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or(raw_ocr)
            .to_string();

        Ok(cleaned)
    }

    /// Deterministically call the scraper and produce a verdict + alternatives.
    ///
    /// Parses `comparison_query_json` (built by the Python OCR service), calls
    /// the scraper, then formats:
    ///   - a verdict comparing the booked price (if known) to the current cheapest
    ///   - a numbered list of the top-3 live alternatives
    ///
    /// Returns `None` if the scraper call fails or returns no results so the
    /// caller can degrade gracefully.
    async fn auto_compare(&self, query_json: &str) -> Option<String> {
        let query: serde_json::Value = serde_json::from_str(query_json).ok()?;

        let origin       = query["origin"].as_str()?.to_string();
        let destination  = query["destination"].as_str()?.to_string();
        let depart_date  = query["depart_date"].as_str()?.to_string();
        let return_date  = query.get("return_date")
                               .and_then(|v| v.as_str())
                               .unwrap_or("")
                               .to_string();
        let adults       = query["adults"].as_u64().unwrap_or(1) as u32;
        let is_one_way   = query.get("trip_type")
                               .and_then(|v| v.as_str())
                               .map(|t| t == "one_way")
                               .unwrap_or(true);
        let price_paid   = query.get("price_paid").and_then(|v| v.as_f64());
        let currency     = query.get("currency")
                               .and_then(|v| v.as_str())
                               .unwrap_or("EUR")
                               .to_string();

        let response = self.scraper_client
            .search(
                origin.clone(),
                destination.clone(),
                depart_date.clone(),
                return_date,
                adults,
                0,
                is_one_way,
            )
            .await
            .ok()?;

        if response.offers.is_empty() {
            return Some("No live flights found for comparison.".to_string());
        }

        let top: Vec<_> = response.offers.iter().take(3).collect();
        let cheapest_eur = top[0].price_eur as f64;

        // FX conversion: fetch live EUR rate for the booked currency.
        let paid_eur: Option<f64> = if let Some(paid) = price_paid {
            if currency == "EUR" {
                Some(paid)
            } else {
                let fx_url = format!(
                    "https://open.er-api.com/v6/latest/{}",
                    currency
                );
                self.http
                    .get(&fx_url)
                    .timeout(std::time::Duration::from_secs(5))
                    .send()
                    .await
                    .ok()
                    .and_then(|r| {
                        futures::executor::block_on(r.json::<serde_json::Value>()).ok()
                    })
                    .and_then(|v| v["rates"]["EUR"].as_f64())
                    .map(|rate| (paid * rate * 100.0).round() / 100.0)
            }
        } else {
            None
        };

        let verdict = match (price_paid, paid_eur) {
            (Some(paid_orig), Some(paid_conv)) => {
                let fx_note = if currency != "EUR" {
                    format!(" ({paid_orig:.2} {currency} converted)")
                } else {
                    String::new()
                };
                if cheapest_eur < paid_conv * 0.95 {
                    format!(
                        "⚠️  Cheaper options available! You paid {paid_conv:.2} EUR{fx_note}; \
                         current cheapest is {cheapest_eur:.2} EUR \
                         (save ~{:.2} EUR).",
                        paid_conv - cheapest_eur,
                    )
                } else if cheapest_eur > paid_conv * 1.05 {
                    format!(
                        "✅  Good deal! You paid {paid_conv:.2} EUR{fx_note}; \
                         current cheapest is {cheapest_eur:.2} EUR."
                    )
                } else {
                    format!(
                        "✅  Fair price. You paid {paid_conv:.2} EUR{fx_note}; \
                         current cheapest is {cheapest_eur:.2} EUR."
                    )
                }
            }
            (Some(paid_orig), None) => format!(
                "You paid {paid_orig:.2} {currency} (FX unavailable). \
                 Current cheapest: {cheapest_eur:.2} EUR."
            ),
            _ => format!("Current cheapest: {cheapest_eur:.2} EUR."),
        };

        let alt_lines: Vec<String> = top
            .iter()
            .enumerate()
            .map(|(i, o)| {
                let ret = if o.return_date.trim().is_empty() {
                    "one-way".to_string()
                } else {
                    o.return_date.clone()
                };
                format!(
                    "  {}. {} {} → {} | depart {} | return {} | {} | {:.2} EUR | {} stop(s) | {}min",
                    i + 1,
                    o.airline,
                    o.flight_number,
                    o.destination,
                    o.depart_date,
                    ret,
                    o.origin,
                    o.price_eur,
                    o.stops,
                    o.duration_minutes,
                )
            })
            .collect();

        Some(format!(
            "{}\n\nLive alternatives ({} → {}, {}):\n{}",
            verdict,
            origin,
            destination,
            depart_date,
            alt_lines.join("\n"),
        ))
    }
}

impl Tool for OcrTool {
    const NAME: &'static str = "extract_booking_info";

    type Error = OcrToolError;
    type Args = ExtractBookingArgs;
    type Output = ExtractBookingOutput;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Extract structured booking details from a travel confirmation screenshot \
                          such as a plane ticket, hotel reservation, or itinerary. Use this when \
                          the image looks like a document or booking confirmation rather than a scenic photo."
                .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "The conversation session identifier"
                    },
                    "image_path": {
                        "type": "string",
                        "description": "Absolute or relative path to the booking screenshot image"
                    }
                },
                "required": ["session_id", "image_path"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let response = self
            .client
            .extract_booking_info(args.session_id, args.image_path, "tesseract".to_string())
            .await?;

        if !response.success {
            let error = response.error.unwrap_or_else(|| "OCR extraction failed".to_string());
            return Ok(ExtractBookingOutput {
                summary: format!("OCR extraction failed: {error}"),
                comparison_query_json: None,
                trip_check: None,
            });
        }

        // Run LLM cleanup on the raw Tesseract output if available.
        let summary = if response.raw_ocr_text.is_empty() {
            response.summary
        } else {
            self.llm_clean(&response.raw_ocr_text)
                .await
                .unwrap_or(response.summary)
        };

        // Deterministically call the scraper when OCR produced a comparison query.
        // This replaces the previous approach of leaving the scraper call to the LLM.
        let trip_check = if let Some(ref qjson) = response.comparison_query_json {
            self.auto_compare(qjson).await
        } else {
            None
        };

        Ok(ExtractBookingOutput {
            summary,
            comparison_query_json: response.comparison_query_json,
            trip_check,
        })
    }
}
