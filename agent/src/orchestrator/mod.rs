//! Orchestration engine — builds and runs the rig multi-tool agent.
//!
//! [`OrchestrationEngine`] is constructed once at startup and shared via `Arc`.
//! Each call to [`OrchestrationEngine::process`] runs the agent directly —
//! the preamble instructs the LLM to respond in the user's language.

pub mod preamble;

use std::sync::Arc;

use rig::client::CompletionClient;
use rig::completion::Prompt;
use rig::providers::openai;
use tracing::{info, instrument, warn};

use crate::{
    config::Config,
    error::AppError,
    tools::DestinationIdTool,
    tools::OcrTool,
    tools::ScraperTool,
    tools::ocr::client::OcrClient,
    tools::scraper::client::ScraperClient,
};

/// The central orchestrator — owns the LLM client and shared tool instances.
pub struct OrchestrationEngine {
    config: Arc<Config>,
    llm_client: openai::Client,
    scraper_tool: ScraperTool,
    ocr_tool: OcrTool,
    dest_tool: DestinationIdTool,
}

pub struct ProcessResult {
    pub reply: String,
}

impl OrchestrationEngine {
    /// Construct the engine and connect to all downstream services.
    pub fn new(config: Arc<Config>) -> Result<Self, AppError> {
        let llm_client = openai::Client::builder()
            .api_key(config.featherless_api_key.clone())
            .base_url(&config.featherless_base_url)
            .build()
            .map_err(|e| AppError::Llm(format!("LLM client init failed: {e}")))?;

        let http = reqwest::Client::new();

        let scraper_client = Arc::new(ScraperClient::connect(config.scraper_grpc_url.clone())?);
        let ocr_client = Arc::new(OcrClient::connect(config.ocr_grpc_url.clone())?);

        let scraper_tool = ScraperTool::new(Arc::clone(&scraper_client));
        let ocr_tool = OcrTool::new(
            Arc::clone(&ocr_client),
            config.featherless_api_key.clone(),
            config.featherless_base_url.clone(),
            config.featherless_model.clone(),
            http.clone(),
        );
        let dest_tool = DestinationIdTool::new(
            config.featherless_api_key.clone(),
            config.featherless_base_url.clone(),
            config.destination_id_model.clone(),
            http,
        );

        Ok(Self {
            config,
            llm_client,
            scraper_tool,
            ocr_tool,
            dest_tool,
        })
    }

    /// Process a user message — runs the agent and returns its reply.
    ///
    /// The LLM is instructed via the preamble to always respond in the same
    /// language the user wrote in, so no translation step is needed.
    #[instrument(skip(self), fields(session_id = %session_id))]
    pub async fn process(
        &self,
        session_id: &str,
        user_message: &str,
    ) -> Result<ProcessResult, AppError> {
        info!(user_message, "Processing request");
        info!(model = %self.config.featherless_model, "Calling agent LLM");

        let agent = self.llm_client
            .agent(&self.config.featherless_model)
            .preamble(&preamble::build())
            .tool(self.scraper_tool.clone())
            .tool(self.ocr_tool.clone())
            .tool(self.dest_tool.clone())
            .build();

        let reply = agent
            .prompt(user_message)
            .await
            .map_err(|e| {
                warn!(error = %e, "Agent LLM call failed");
                AppError::Llm(e.to_string())
            })?;

        info!(reply_len = reply.len(), "Agent responded");

        Ok(ProcessResult { reply })
    }
}
