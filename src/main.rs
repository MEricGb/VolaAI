//! CLI orchestrator — calls scraper gRPC then agent gRPC, prints the reply.

mod config;
mod error;

pub mod scraping {
    tonic::include_proto!("scraping");
}

pub mod agent_proto {
    tonic::include_proto!("agent");
}

use std::io::{self, BufRead, Write};
use std::sync::Arc;

use anyhow::Result;
use tracing::info;
use uuid::Uuid;

use agent_proto::{agent_service_client::AgentServiceClient, ChatRequest};
use scraping::{
    scraping_service_client::ScrapingServiceClient,
    search_response::Result as ScrapingResult,
    SearchRequest,
};

use config::Config;

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "vibehack_2026=info,warn".parse().unwrap()),
        )
        .init();

    let config = Arc::new(Config::from_env()?);
    let session_id = Uuid::new_v4().to_string();

    info!(%session_id, "Connecting to services");

    let mut scraper = ScrapingServiceClient::connect(config.scraping_grpc_url.clone()).await?;
    let mut agent   = AgentServiceClient::connect(config.agent_grpc_url.clone()).await?;

    println!("✈  Flight Assistant  (type /quit to exit)\n");

    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let input = line?;
        let trimmed = input.trim();

        if trimmed.is_empty() {
            continue;
        }
        if trimmed == "/quit" || trimmed == "/exit" {
            println!("Bye!");
            break;
        }

        // ── 1. Call scraper ───────────────────────────────────────────────────
        let scraper_resp = scraper
            .search_flights(SearchRequest {
                session_id:   session_id.clone(),
                user_message: trimmed.to_string(),
            })
            .await?
            .into_inner();

        let tool_context = match scraper_resp.result {
            Some(ScrapingResult::Flights(f)) if f.offers.is_empty() => {
                "No flights found matching your criteria.".to_string()
            }
            Some(ScrapingResult::Flights(f)) => {
                let mut out = format!("Found {} flight offer(s):\n", f.offers.len());
                for o in &f.offers {
                    out.push_str(&format!(
                        "- {} | {} → {} on {} | {}min | {} stop(s) | €{:.2} | {}\n",
                        o.airline, o.origin, o.destination, o.depart_date,
                        o.duration_minutes, o.stops, o.price_eur, o.deep_link,
                    ));
                }
                out
            }
            Some(ScrapingResult::Clarification(c)) => c.question,
            Some(ScrapingResult::NoSearch(n))      => n.reason,
            None => String::new(),
        };

        // ── 2. Call agent ─────────────────────────────────────────────────────
        let agent_resp = agent
            .chat(ChatRequest {
                user_message: trimmed.to_string(),
                tool_context,
            })
            .await?
            .into_inner();

        println!("{}\n", agent_resp.reply);

        print!("> ");
        io::stdout().flush()?;
    }

    Ok(())
}
