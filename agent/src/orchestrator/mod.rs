//! Orchestration engine — builds and runs the rig multi-tool agent.
//!
//! [`OrchestrationEngine`] is constructed once at startup and shared via `Arc`.
//! Each call to [`OrchestrationEngine::process`] runs the agent directly —
//! the preamble instructs the LLM to respond in the user's language.

pub mod preamble;

use std::sync::Arc;

use base64::engine::Engine as _;
use base64::engine::general_purpose;
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
    ocr_client: Arc<OcrClient>,
    http: reqwest::Client,
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
            config.featherless_api_key.clone(),
            config.featherless_base_url.clone(),
            config.featherless_model.clone(),
            http.clone(),
        );
        let dest_tool = DestinationIdTool::new(
            config.featherless_api_key.clone(),
            config.featherless_base_url.clone(),
            config.destination_id_model.clone(),
            http.clone(),
        );

        Ok(Self {
            config,
            llm_client,
            scraper_tool,
            ocr_tool,
            dest_tool,
            ocr_client,
            http: http.clone(),
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
        image_urls: &[String],
    ) -> Result<ProcessResult, AppError> {
        info!(user_message, "Processing request");

        // Pre-process images before building the rig agent
        let image_context = if !image_urls.is_empty() {
            self.preprocess_images(session_id, image_urls).await
        } else {
            String::new()
        };

        // Prepend image context to user_message for the rest of the pipeline
        let user_message = if image_context.is_empty() {
            user_message.to_string()
        } else {
            format!("[Image context]\n{image_context}\n\n[User message]\n{user_message}")
        };
        let user_message = user_message.as_str();

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

    /// Download and analyse each image URL.
    /// Returns a combined context string to prepend to the user message.
    async fn preprocess_images(&self, session_id: &str, image_urls: &[String]) -> String {
        let mut context_parts: Vec<String> = Vec::new();

        for (i, url) in image_urls.iter().enumerate() {
            let label = format!("Image {}", i + 1);

            // 1. Try OCR first (direct gRPC call — not a rig tool invocation)
            match self.ocr_client
                .extract_booking_info(
                    session_id.to_string(),
                    url.clone(),
                    "tesseract".to_string(),
                )
                .await
            {
                Ok(resp) if resp.success => {
                    let mut parts = vec![resp.summary.clone()];
                    if let Some(q) = &resp.comparison_query_json {
                        parts.push(format!("comparison_query: {q}"));
                    }
                    context_parts.push(format!("{label} (booking document): {}", parts.join("; ")));
                    continue;
                }
                Ok(_) => {
                    tracing::debug!(url, "OCR found no booking; trying vision LLM");
                }
                Err(e) => {
                    tracing::warn!(url, error = %e, "OCR call failed; trying vision LLM");
                }
            }

            // 2. Fall back to vision LLM with base64-encoded image bytes
            match self.describe_image_with_vision(url).await {
                Ok(description) => {
                    context_parts.push(format!("{label} (photo): {description}"));
                }
                Err(e) => {
                    tracing::warn!(url, error = %e, "Vision LLM failed; skipping image");
                }
            }
        }

        context_parts.join("\n")
    }

    /// Download image bytes from a public MinIO URL and send to the vision LLM.
    async fn describe_image_with_vision(&self, url: &str) -> Result<String, AppError> {
        let bytes = reqwest::get(url)
            .await
            .map_err(|e| AppError::Llm(format!("Failed to download image: {e}")))?
            .bytes()
            .await
            .map_err(|e| AppError::Llm(format!("Failed to read image bytes: {e}")))?;

        let mime = image::guess_format(&bytes)
            .map(|fmt| match fmt {
                image::ImageFormat::Jpeg => "image/jpeg",
                image::ImageFormat::Png  => "image/png",
                image::ImageFormat::Gif  => "image/gif",
                image::ImageFormat::WebP => "image/webp",
                _                        => "image/jpeg",
            })
            .unwrap_or("image/jpeg");

        let b64 = general_purpose::STANDARD.encode(&bytes);
        let data_uri = format!("data:{mime};base64,{b64}");

        let payload = serde_json::json!({
            "model": self.config.destination_id_model,
            "messages": [{
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": { "url": data_uri }
                    },
                    {
                        "type": "text",
                        "text": "Describe this image in the context of travel planning. What does it show? Be concise (1-3 sentences)."
                    }
                ]
            }],
            "max_tokens": 256,
            "temperature": 0.0
        });

        let resp: serde_json::Value = self.http
            .post(format!("{}/chat/completions", self.config.featherless_base_url))
            .bearer_auth(&self.config.featherless_api_key)
            .json(&payload)
            .send()
            .await
            .map_err(|e| AppError::Llm(format!("Vision LLM request failed: {e}")))?
            .json()
            .await
            .map_err(|e| AppError::Llm(format!("Vision LLM response parse failed: {e}")))?;

        let description = resp["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("(image received, no description available)")
            .to_string();

        Ok(description)
    }
}
