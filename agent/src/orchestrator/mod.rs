//! Three-stage orchestration pipeline.
//!
//! Each user message flows through three isolated LLM calls:
//!
//! 1. **Tool selector** (fast model) — reads tool descriptions, decides which
//!    tool is relevant and extracts parameters from the user message.
//! 2. **Tool executor** (fast model, agent with tools) — receives the selection
//!    from stage 1 and invocation rules, then actually calls the tool.
//! 3. **Response generator** (main model) — receives only the user message and
//!    the tool results. It never sees tool names, descriptions, or invocation
//!    rules, so it cannot leak them.

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
    llm_client: openai::CompletionsClient,
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
        let llm_client = openai::CompletionsClient::builder()
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
            Arc::clone(&scraper_client),
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

    /// Stage 1 — Tool selector (fast model, no tools).
    ///
    /// Reads the tool descriptions and the user message, then outputs which
    /// tool to call and what parameters to use. Returns a structured
    /// selection string that stage 2 can act on.
    async fn select_tool(&self, user_message: &str) -> Result<String, AppError> {
        let selector = self.llm_client
            .agent(&self.config.fast_model)
            .preamble(preamble::build_tool_descriptions())
            .build();

        let selection = selector
            .prompt(user_message)
            .await
            .map_err(|e| {
                warn!(error = %e, "Stage 1 (tool selection) failed");
                AppError::Llm(e.to_string())
            })?;

        info!(selection = %selection, "Stage 1 complete — tool selected");
        Ok(selection)
    }

    /// Stage 2 — Tool executor (fast model, agent with tools).
    ///
    /// Receives the tool selection from stage 1 plus the invocation rules,
    /// then calls the appropriate tool and returns the raw result.
    async fn invoke_tool(
        &self,
        user_message: &str,
        tool_selection: &str,
    ) -> Result<String, AppError> {
        let executor = self.llm_client
            .agent(&self.config.fast_model)
            .preamble(preamble::build_tool_invocation())
            .tool(self.scraper_tool.clone())
            .tool(self.ocr_tool.clone())
            .tool(self.dest_tool.clone())
            .build();

        let prompt = format!(
            "Tool selection from previous analysis:\n{tool_selection}\n\n\
             User message:\n{user_message}"
        );

        let tool_result = executor
            .prompt(&prompt)
            .await
            .map_err(|e| {
                warn!(error = %e, "Stage 2 (tool invocation) failed");
                AppError::Llm(e.to_string())
            })?;

        info!(result_len = tool_result.len(), "Stage 2 complete — tool invoked");
        Ok(tool_result)
    }

    /// Stage 3 — Response generator (main model, no tools).
    ///
    /// Receives only the user message and the tool results. It never sees
    /// tool names, descriptions, or invocation rules, preventing any leakage
    /// of internal details into the user-facing response.
    async fn generate_response(
        &self,
        user_message: &str,
        tool_result: &str,
    ) -> Result<String, AppError> {
        let responder = self.llm_client
            .agent(&self.config.featherless_model)
            .preamble(&preamble::build_response_prompt())
            .build();

        let prompt = format!(
            "User message:\n{user_message}\n\n\
             Information:\n{tool_result}"
        );

        let reply = responder
            .prompt(&prompt)
            .await
            .map_err(|e| {
                warn!(error = %e, "Stage 3 (response generation) failed");
                AppError::Llm(e.to_string())
            })?;

        Ok(reply)
    }

    /// Process a user message through the three-stage pipeline.
    #[instrument(skip(self), fields(session_id = %session_id))]
    pub async fn process(
        &self,
        session_id: &str,
        user_message: &str,
    ) -> Result<ProcessResult, AppError> {
        info!(user_message, "Processing request — 3-stage pipeline");

        // Stage 1: select tool (fast model)
        let tool_selection = self.select_tool(user_message).await?;

        // Stage 2: invoke tool (fast model + tools)
        let tool_result = self.invoke_tool(user_message, &tool_selection).await?;

        // Stage 3: generate response (main model, no tool internals)
        let reply = self.generate_response(user_message, &tool_result).await?;

        info!(reply_len = reply.len(), "Pipeline complete");
        Ok(ProcessResult { reply })
    }
}
