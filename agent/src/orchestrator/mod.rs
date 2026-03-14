//! Orchestration engine — builds and runs the rig multi-tool agent.
//!
//! [`OrchestrationEngine`] is constructed once at startup and shared via `Arc`.
//! Each call to [`OrchestrationEngine::process`] builds a fresh rig agent,
//! registers all tools, and executes the user prompt.

pub mod preamble;

use std::sync::Arc;

use rig::client::CompletionClient;
use rig::completion::Prompt;
use rig::providers::openai;
use tracing::{info, instrument};

use crate::{
    config::Config,
    error::AppError,
    tools::DestinationIdTool,
    tools::OcrTool,
    tools::ScraperTool,
    tools::ocr::client::OcrClient,
    tools::scraper::client::ScraperClient,
};

/// The central orchestrator — owns the LLM config and shared tool clients.
pub struct OrchestrationEngine {
    config: Arc<Config>,
    scraper_client: Arc<ScraperClient>,
    ocr_client: Arc<OcrClient>,
}

impl OrchestrationEngine {
    /// Construct the engine and connect to all downstream services.
    pub fn new(config: Arc<Config>) -> Result<Self, AppError> {
        let scraper_client = Arc::new(
            ScraperClient::connect(config.scraper_grpc_url.clone())?,
        );
        let ocr_client = Arc::new(OcrClient::connect(config.ocr_grpc_url.clone())?);
        Ok(Self {
            config,
            scraper_client,
            ocr_client,
        })
    }

    /// Process a user message through the orchestrator.
    ///
    /// Builds a rig agent with all registered tools, runs the prompt,
    /// and returns the composed reply.
    #[instrument(skip(self), fields(session_id = %session_id))]
    pub async fn process(
        &self,
        session_id: &str,
        user_message: &str,
    ) -> Result<String, AppError> {
        info!(user_message, "Processing request");

        let client = openai::CompletionsClient::builder()
            .api_key(self.config.featherless_api_key.clone())
            .base_url(&self.config.featherless_base_url)
            .build()
            .map_err(|e| AppError::Llm(format!("LLM client init failed: {e}")))?;

        let agent = client
            .agent(&self.config.featherless_model)
            .preamble(&preamble::build())
            .tool(ScraperTool::new(Arc::clone(&self.scraper_client)))
            .tool(OcrTool::new(Arc::clone(&self.ocr_client)))
            .tool(DestinationIdTool::new(
                self.config.featherless_api_key.clone(),
                self.config.featherless_base_url.clone(),
                self.config.destination_id_model.clone(),
            ))
            .build();

        let reply = agent
            .prompt(user_message)
            .await
            .map_err(|e| AppError::Llm(e.to_string()))?;

        Ok(reply)
    }
}
