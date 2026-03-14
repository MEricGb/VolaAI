//! Flight search tool — wraps the Python scraper service as a rig [`Tool`].
//!
//! The LLM calls this tool when it decides the user's message requires a
//! flight search. It delegates to [`ScraperClient`] over gRPC and returns
//! a human-readable summary of the scraper's response.

pub mod client;

use std::sync::Arc;

use rig::{completion::ToolDefinition, tool::Tool};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use client::{scraping_proto::search_response::Result as ScraperResult, ScraperClient};

/// Arguments the LLM passes when invoking the search_flights tool.
#[derive(Debug, Deserialize)]
pub struct SearchFlightsArgs {
    pub session_id: String,
    pub user_message: String,
}

/// Serializable output returned to the LLM after tool execution.
#[derive(Debug, Serialize)]
pub struct SearchFlightsOutput {
    pub summary: String,
}

/// Errors that can occur during flight search tool execution.
#[derive(Debug, thiserror::Error)]
pub enum ScraperToolError {
    #[error("Scraper call failed: {0}")]
    Rpc(#[from] AppError),
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

    type Error = ScraperToolError;
    type Args = SearchFlightsArgs;
    type Output = SearchFlightsOutput;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Search for flights based on the user's travel request. \
                          Call this whenever the user asks about flights, prices, \
                          routes, or travel plans. Pass the session_id and the \
                          user's exact message."
                .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "The conversation session identifier"
                    },
                    "user_message": {
                        "type": "string",
                        "description": "The user's raw message requesting flight information"
                    }
                },
                "required": ["session_id", "user_message"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let response = self
            .client
            .search(args.session_id, args.user_message)
            .await?;

        let summary = match response.result {
            Some(ScraperResult::Flights(results)) => {
                if results.offers.is_empty() {
                    "No flights found for the given route and dates.".to_string()
                } else {
                    let lines: Vec<String> = results
                        .offers
                        .iter()
                        .take(5)
                        .map(|o| {
                            format!(
                                "{} → {} on {} | {} | €{:.2} | {} stops | {}min",
                                o.origin,
                                o.destination,
                                o.depart_date,
                                o.airline,
                                o.price_eur,
                                o.stops,
                                o.duration_minutes,
                            )
                        })
                        .collect();
                    format!("Found {} flight(s):\n{}", results.offers.len(), lines.join("\n"))
                }
            }
            Some(ScraperResult::Clarification(c)) => {
                format!(
                    "Need clarification — {}\nMissing: {}",
                    c.question,
                    c.missing_fields.join(", ")
                )
            }
            Some(ScraperResult::NoSearch(ns)) => {
                format!("No search triggered: {}", ns.reason)
            }
            None => return Err(ScraperToolError::Rpc(AppError::UnexpectedResponse)),
        };

        Ok(SearchFlightsOutput { summary })
    }
}
