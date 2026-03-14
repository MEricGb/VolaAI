//! Flight search tool — wraps the Python scraper service as a rig [`Tool`].
//!
//! The LLM calls this tool when it decides the user's message requires a
//! flight search. It delegates to [`ScraperClient`] over gRPC and returns
//! a human-readable summary of the results.

pub mod client;

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
            let lines: Vec<String> = response
                .offers
                .iter()
                .take(5)
                .map(|o| {
                    format!(
                        "{} → {} on {} | {} | €{:.2} | {} stop(s) | {}min | {}",
                        o.origin,
                        o.destination,
                        o.depart_date,
                        o.airline,
                        o.price_eur,
                        o.stops,
                        o.duration_minutes,
                        o.deep_link,
                    )
                })
                .collect();
            format!("Found {} flight(s):\n{}", response.offers.len(), lines.join("\n"))
        };

        Ok(SearchFlightsOutput { summary })
    }
}
