//! Agent service configuration.
//!
//! Loads all settings from environment variables on startup.

use anyhow::{Context, Result};

/// Runtime configuration for the agent service.
pub struct Config {
    pub featherless_api_key:  String,
    pub featherless_base_url: String,
    pub featherless_model:    String,
    pub destination_id_model: String,
    pub grpc_port:            u16,
    pub scraper_grpc_url:     String,
    pub ocr_grpc_url:         String,
    pub minio_endpoint:       String,
    pub minio_port:           u16,
    pub minio_bucket:         String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let featherless_model = std::env::var("FEATHERLESS_MODEL")
            .unwrap_or_else(|_| "Qwen/Qwen2.5-14B-Instruct".to_string());

        Ok(Self {
            featherless_api_key: std::env::var("FEATHERLESS_API_KEY")
                .context("FEATHERLESS_API_KEY must be set")?,

            featherless_base_url: std::env::var("FEATHERLESS_BASE_URL")
                .unwrap_or_else(|_| "https://api.featherless.ai/v1".to_string()),

            featherless_model: featherless_model.clone(),

            destination_id_model: std::env::var("DESTINATION_ID_MODEL")
                .unwrap_or_else(|_| "Qwen/Qwen3-VL-30B-A3B-Instruct".to_string()),

            grpc_port: std::env::var("AGENT_GRPC_PORT")
                .unwrap_or_else(|_| "50052".to_string())
                .parse()
                .context("AGENT_GRPC_PORT must be a valid port number")?,

            scraper_grpc_url: std::env::var("SCRAPER_GRPC_URL")
                .unwrap_or_else(|_| "http://[::1]:50051".to_string()),

            ocr_grpc_url: std::env::var("OCR_GRPC_URL")
                .unwrap_or_else(|_| "http://[::1]:50053".to_string()),

            minio_endpoint: std::env::var("MINIO_ENDPOINT")
                .unwrap_or_else(|_| "localhost".to_string()),
            minio_port: std::env::var("MINIO_PORT")
                .unwrap_or_else(|_| "9000".to_string())
                .parse()
                .context("MINIO_PORT must be a valid port number")?,
            minio_bucket: std::env::var("MINIO_BUCKET")
                .unwrap_or_else(|_| "whatsapp-media".to_string()),
        })
    }
}
