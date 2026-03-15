//! Flight search tool — wraps the Python scraper service as a rig [`Tool`].
//!
//! The LLM calls this tool when it decides the user's message requires a
//! flight search. It delegates to [`ScraperClient`] over gRPC and returns
//! a human-readable summary of the results.

pub mod client;

use std::time::Duration;
use std::sync::Arc;

use rig::{completion::ToolDefinition, tool::Tool};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use client::ScraperClient;

/// Arguments the LLM fills when invoking the search_flights tool.
#[derive(Debug, Deserialize)]
pub struct SearchFlightsArgs {
    pub origin: String,
    pub destination: String,
    pub depart_date: String,
    pub return_date: Option<String>,
    pub adults: Option<u32>,
    pub children: Option<u32>,
    pub is_one_way: Option<bool>,
    pub include_links: Option<bool>,
    pub option_index: Option<u32>,
}

/// Serializable output returned to the LLM after tool execution.
#[derive(Debug, Serialize)]
pub struct SearchFlightsOutput {
    pub summary: String,
}

/// rig tool that searches for flights by calling the Python scraper service.
#[derive(Clone)]
pub struct ScraperTool {
    client: Arc<ScraperClient>,
}

impl ScraperTool {
    pub fn new(client: Arc<ScraperClient>) -> Self {
        Self { client }
    }
}

async fn looks_unavailable_booking_page(url: &str) -> bool {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };

    let response = match client
        .get(url)
        .header(
            reqwest::header::USER_AGENT,
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        )
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return false,
    };

    let body = match response.text().await {
        Ok(text) => text.to_lowercase(),
        Err(_) => return false,
    };

    [
        "fully booked",
        "sold out",
        "not available",
        "no longer available",
        "nu mai este disponibil",
    ]
    .iter()
    .any(|needle| body.contains(needle))
}

async fn pick_available_offer<'a>(
    top: &[&'a client::scraping_proto::FlightOffer],
    requested_idx: usize,
) -> Option<(usize, &'a client::scraping_proto::FlightOffer)> {
    if top.is_empty() {
        return None;
    }

    // Probe all offers in parallel instead of sequentially.
    let probes: Vec<_> = top
        .iter()
        .enumerate()
        .map(|(i, offer)| {
            let url = offer.deep_link.clone();
            async move { (i, !looks_unavailable_booking_page(&url).await) }
        })
        .collect();

    let results = futures::future::join_all(probes).await;

    // Prefer the requested index if available, then take the first available.
    if requested_idx < results.len() && results[requested_idx].1 {
        return Some((requested_idx, top[requested_idx]));
    }
    if let Some((idx, _)) = results.iter().find(|(_, available)| *available) {
        return Some((*idx, top[*idx]));
    }

    // All look unavailable — return requested or first.
    if requested_idx < top.len() {
        Some((requested_idx, top[requested_idx]))
    } else {
        Some((0, top[0]))
    }
}

impl Tool for ScraperTool {
    const NAME: &'static str = "search_flights";

    type Error = AppError;
    type Args = SearchFlightsArgs;
    type Output = SearchFlightsOutput;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Search for real flights via the Vola flight search engine. \
                Call this tool whenever the user asks about flights, prices, routes, or travel. \
                You MUST resolve city names to IATA codes before calling — use the reference below.\n\n\
                City → IATA reference:\n\
                bucharest/bucurești → OTP, cluj/cluj-napoca → CLJ, timișoara → TSR, \
                iași/iasi → IAS, sibiu → SBZ, constanța → CND, târgu mureș → TGM, \
                oradea → OMR, suceava → SCV, craiova → CRA, bacău → BCM, \
                london → LHR, gatwick → LGW, luton → LTN, stansted → STN, \
                manchester → MAN, edinburgh → EDI, birmingham → BHX, dublin → DUB, \
                paris → CDG, orly → ORY, amsterdam → AMS, brussels → BRU, \
                frankfurt → FRA, munich → MUC, berlin → BER, vienna → VIE, \
                zurich → ZRH, geneva → GVA, milan → MXP, rome → FCO, venice → VCE, \
                madrid → MAD, barcelona → BCN, valencia → VLC, malaga → AGP, \
                lisbon → LIS, porto → OPO, stockholm → ARN, oslo → OSL, \
                copenhagen → CPH, helsinki → HEL, prague → PRG, budapest → BUD, \
                warsaw → WAW, sofia → SOF, belgrade → BEG, zagreb → ZAG, \
                athens → ATH, istanbul → IST, antalya → AYT, dubai → DXB, \
                tel aviv → TLV, cairo → CAI, new york → JFK, los angeles → LAX, \
                miami → MIA, toronto → YYZ, montreal → YUL, tokyo → NRT, \
                singapore → SIN, bangkok → BKK, bali → DPS, delhi → DEL, mumbai → BOM\n\n\
                If only a month is given with no exact date, use the 1st of that month \
                (e.g. 'June' → depart_date: '2026-06-01'). \
                Default adults to 1 if not specified."
                .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "origin": {
                        "type": "string",
                        "description": "Departure airport IATA code (e.g. 'OTP')"
                    },
                    "destination": {
                        "type": "string",
                        "description": "Arrival airport IATA code (e.g. 'BCN')"
                    },
                    "depart_date": {
                        "type": "string",
                        "description": "Departure date in YYYY-MM-DD format"
                    },
                    "return_date": {
                        "type": "string",
                        "description": "Return date in YYYY-MM-DD format, omit for one-way"
                    },
                    "adults": {
                        "type": "integer",
                        "description": "Number of adult passengers (default 1)"
                    },
                    "children": {
                        "type": "integer",
                        "description": "Number of child passengers (default 0)"
                    },
                    "is_one_way": {
                        "type": "boolean",
                        "description": "True for one-way, false/omit for round-trip"
                    },
                    "include_links": {
                        "type": "boolean",
                        "description": "Set true when the user explicitly asks for booking link(s). Default false."
                    },
                    "option_index": {
                        "type": "integer",
                        "description": "1-based option number from the previously shown list. Use with include_links=true."
                    }
                },
                "required": ["origin", "destination", "depart_date"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        tracing::info!(
            origin = %args.origin,
            destination = %args.destination,
            depart_date = %args.depart_date,
            return_date = ?args.return_date,
            adults = args.adults.unwrap_or(1),
            is_one_way = args.is_one_way.unwrap_or(false),
            "ScraperTool: calling scraper"
        );

        let response = self
            .client
            .search(
                args.origin,
                args.destination,
                args.depart_date,
                args.return_date.unwrap_or_default(),
                args.adults.unwrap_or(1),
                args.children.unwrap_or(0),
                args.is_one_way.unwrap_or(false),
            )
            .await?;

        tracing::info!(count = response.offers.len(), "ScraperTool: received offers");

        let summary = if response.offers.is_empty() {
            "No flights found for the given route and dates.".to_string()
        } else {
            let top: Vec<_> = response.offers.iter().take(5).collect();
            let include_links = args.include_links.unwrap_or(false);
            let selected_option = args.option_index.and_then(|n| n.checked_sub(1)).map(|n| n as usize);

            if include_links
                && let Some(idx) = selected_option
                && let Some((picked_idx, o)) = pick_available_offer(&top, idx).await
            {
                let return_date = if o.return_date.trim().is_empty() {
                    "one-way".to_string()
                } else {
                    o.return_date.clone()
                };

                let selection_note = if picked_idx == idx {
                    format!("selected option {} is currently available", idx + 1)
                } else {
                    format!(
                        "requested option {} looked unavailable; switched to available option {}",
                        idx + 1,
                        picked_idx + 1
                    )
                };

                return Ok(SearchFlightsOutput {
                    summary: format!(
                    "{}\noption {} | offer_id {} | {} -> {} | depart {} | return {} | airline {} | price_eur {:.2} | stops {} | duration_min {}\nbooking_url: {}",
                    selection_note,
                    picked_idx + 1,
                    o.offer_id,
                    o.origin,
                    o.destination,
                    o.depart_date,
                    return_date,
                    o.airline,
                    o.price_eur,
                    o.stops,
                    o.duration_minutes,
                    o.deep_link,
                ),
                });
            }

            let lines: Vec<String> = top
                .iter()
                .enumerate()
                .map(|(idx, o)| {
                    let return_date = if o.return_date.trim().is_empty() {
                        "one-way".to_string()
                    } else {
                        o.return_date.clone()
                    };

                    format!(
                        "option {} | offer_id {} | {} -> {} | depart {} | return {} | airline {} | price_eur {:.2} | stops {} | duration_min {}",
                        idx + 1,
                        o.offer_id,
                        o.origin,
                        o.destination,
                        o.depart_date,
                        return_date,
                        o.airline,
                        o.price_eur,
                        o.stops,
                        o.duration_minutes,
                    )
                })
                .collect();

            format!(
                "Found {} flight(s), showing top {} ranked options. Links are available on request by option number.\n{}",
                response.offers.len(),
                lines.len(),
                lines.join("\n")
            )
        };

        Ok(SearchFlightsOutput { summary })
    }
}
