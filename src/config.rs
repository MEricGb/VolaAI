//! CLI orchestrator configuration.

use anyhow::Result;

pub struct Config {
    pub scraping_grpc_url: String,
    pub agent_grpc_url:    String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            scraping_grpc_url: std::env::var("SCRAPING_GRPC_URL")
                .unwrap_or_else(|_| "http://[::1]:50051".to_string()),

            agent_grpc_url: std::env::var("AGENT_GRPC_URL")
                .unwrap_or_else(|_| "http://[::1]:50052".to_string()),
        })
    }
}
