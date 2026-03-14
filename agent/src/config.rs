//! Agent service configuration.

use anyhow::{Context, Result};

pub struct Config {
    pub featherless_api_key:  String,
    pub featherless_base_url: String,
    pub featherless_model:    String,
    pub grpc_port:            u16,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            featherless_api_key: std::env::var("FEATHERLESS_API_KEY")
                .context("FEATHERLESS_API_KEY must be set")?,

            featherless_base_url: std::env::var("FEATHERLESS_BASE_URL")
                .unwrap_or_else(|_| "https://api.featherless.ai/v1".to_string()),

            featherless_model: std::env::var("FEATHERLESS_MODEL")
                .unwrap_or_else(|_| "Qwen/Qwen2.5-32B-Instruct".to_string()),

            grpc_port: std::env::var("AGENT_GRPC_PORT")
                .unwrap_or_else(|_| "50052".to_string())
                .parse()
                .context("AGENT_GRPC_PORT must be a valid port number")?,
        })
    }
}
