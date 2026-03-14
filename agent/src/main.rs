//! Agent gRPC microservice — LLM orchestrator with pluggable tools.
//!
//! ## Architecture
//! - [`orchestrator::OrchestrationEngine`] — builds rig agents and dispatches tools
//! - [`tools::ScraperTool`] — first registered tool, wraps the Python scraper via gRPC
//! - [`server::AgentServiceImpl`] — thin gRPC handler, delegates to the engine

mod config;
mod error;
mod orchestrator;
mod server;
mod tools;

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::{Context, Result};
use tokio::sync::Mutex;
use tonic::transport::Server;
use tracing::info;

pub mod agent_proto {
    tonic::include_proto!("agent");
}

use agent_proto::agent_service_server::AgentServiceServer;
use config::Config;
use orchestrator::OrchestrationEngine;
use server::{AgentServiceImpl, SessionState};

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("agent=info,warn")),
        )
        .init();

    let config = Arc::new(Config::from_env()?);
    let addr = format!("[::1]:{}", config.grpc_port)
        .parse()
        .context("Invalid gRPC address")?;

    let engine = Arc::new(OrchestrationEngine::new(Arc::clone(&config))?);
    let sessions = Arc::new(Mutex::new(HashMap::<String, SessionState>::new()));

    info!(%addr, "Agent gRPC server starting");

    Server::builder()
        .add_service(AgentServiceServer::new(AgentServiceImpl { engine, sessions }))
        .serve(addr)
        .await?;

    Ok(())
}
