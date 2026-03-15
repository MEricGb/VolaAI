//! OCR booking extraction tool — wraps the Python OCR service as a rig [`Tool`].
//!
//! The LLM calls this tool when the user provides a booking screenshot/image path
//! and wants extracted travel details.
//!
//! ## Pipeline
//! 1. The Python OCR service runs Tesseract on the image and returns raw text.
//! 2. This tool sends that raw text to the Featherless LLM for cleanup (fixing
//!    garbled characters, restoring reading order) before returning to the agent.

pub mod client;

use std::sync::Arc;

use rig::{completion::ToolDefinition, tool::Tool};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
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
    client:   Arc<OcrClient>,
    api_key:  String,
    base_url: String,
    model:    String,
    http:     reqwest::Client,
}

impl OcrTool {
    pub fn new(
        client: Arc<OcrClient>,
        api_key: String,
        base_url: String,
        model: String,
        http: reqwest::Client,
    ) -> Self {
        Self {
            client,
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

        Ok(ExtractBookingOutput {
            summary,
            comparison_query_json: response.comparison_query_json,
        })
    }
}
