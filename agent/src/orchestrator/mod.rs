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

/// The central orchestrator — owns the LLM config and shared tool clients.
pub struct OrchestrationEngine {
    config: Arc<Config>,
    scraper_client: Arc<ScraperClient>,
    ocr_client: Arc<OcrClient>,
}

pub struct ProcessResult {
    pub reply: String,
    pub language: String,
}

fn has_script_chars(text: &str, start: char, end: char) -> bool {
    text.chars().any(|c| c >= start && c <= end)
}

fn should_refresh_cached_language(cached_language: &str, text: &str) -> bool {
    let lower = text.to_lowercase();
    let explicit_switch_markers = [
        "answer in",
        "respond in",
        "write in",
        "speak in",
        "in english",
        "în engleză",
        "in romanian",
        "în română",
        "en español",
        "en francais",
        "en français",
        "auf deutsch",
    ];

    if explicit_switch_markers.iter().any(|m| lower.contains(m)) {
        return true;
    }

    let cached = cached_language.to_lowercase();
    let has_cyrillic = has_script_chars(text, '\u{0400}', '\u{04FF}');
    let has_arabic = has_script_chars(text, '\u{0600}', '\u{06FF}');
    let has_han = has_script_chars(text, '\u{4E00}', '\u{9FFF}');

    if has_cyrillic && !matches!(cached.as_str(), "ru" | "uk" | "bg" | "sr" | "mk") {
        return true;
    }
    if has_arabic && cached != "ar" {
        return true;
    }
    if has_han && !matches!(cached.as_str(), "zh" | "ja") {
        return true;
    }

    false
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
        original_user_message: &str,
        preferred_language: Option<&str>,
    ) -> Result<ProcessResult, AppError> {
        info!(user_message, "Processing request");

        let client = openai::CompletionsClient::builder()
            .api_key(self.config.featherless_api_key.clone())
            .base_url(&self.config.featherless_base_url)
            .build()
            .map_err(|e| AppError::Llm(format!("LLM client init failed: {e}")))?;

        info!("LLM client built, detecting language");

        let language = if let Some(lang) = preferred_language {
            if should_refresh_cached_language(lang, original_user_message) {
                info!("Refreshing cached language");
                self
                    .detect_user_language(&client, original_user_message)
                    .await
                    .unwrap_or_else(|e| {
                        warn!(error = %e, "Language refresh failed; keeping cached language");
                        lang.to_string()
                    })
            } else {
                lang.to_string()
            }
        } else {
            self
                .detect_user_language(&client, original_user_message)
                .await
                .unwrap_or_else(|e| {
                    warn!(error = %e, "Language detection failed; defaulting to English");
                    "en".to_string()
                })
        };

        info!(%language, "Language detected");

        let working_message = if language.eq_ignore_ascii_case("en") {
            user_message.to_string()
        } else {
            info!("Translating input to English");
            self.translate_text(
                &client,
                &language,
                "English",
                user_message,
                "Translate the input to English. Keep line breaks and special tokens unchanged.",
            )
            .await
            .unwrap_or_else(|e| {
                warn!(error = %e, "Input translation failed; using original input");
                user_message.to_string()
            })
        };

        info!(model = %self.config.featherless_model, "Calling main agent LLM");

        let agent = client
            .agent(&self.config.featherless_model)
            .preamble(&preamble::build())
            .tool(ScraperTool::new(Arc::clone(&self.scraper_client)))
            .tool(OcrTool::new(
                Arc::clone(&self.ocr_client),
                self.config.featherless_api_key.clone(),
                self.config.featherless_base_url.clone(),
                self.config.featherless_model.clone(),
            ))
            .tool(DestinationIdTool::new(
                self.config.featherless_api_key.clone(),
                self.config.featherless_base_url.clone(),
                self.config.destination_id_model.clone(),
            ))
            .build();

        let reply = agent
            .prompt(&working_message)
            .await
            .map_err(|e| {
                warn!(error = %e, "Main agent LLM call failed");
                AppError::Llm(e.to_string())
            })?;

        info!(reply_len = reply.len(), "Agent LLM responded");

        if language.eq_ignore_ascii_case("en") {
            return Ok(ProcessResult { reply, language });
        }

        info!("Translating reply back to {language}");

        let localized_reply = self
            .translate_text(
                &client,
                "English",
                &language,
                &reply,
                "Translate the assistant reply to the target language while preserving URLs, codes, dates, numbers, and booking_url lines exactly.",
            )
            .await
            .unwrap_or_else(|e| {
                warn!(error = %e, "Output translation failed; returning English reply");
                reply.clone()
            });

        info!("Request complete");

        Ok(ProcessResult {
            reply: localized_reply,
            language,
        })
    }

    async fn detect_user_language(
        &self,
        client: &openai::CompletionsClient,
        text: &str,
    ) -> Result<String, AppError> {
        let detector = client
            .agent(&self.config.translation_model)
            .preamble("Detect the primary language of the provided text. Return only a lowercase ISO-639-1 code like en, ro, es, fr, de, it, pt, tr, ar, ru, uk, zh, ja. No extra text.")
            .build();

        let code = detector
            .prompt(text)
            .await
            .map_err(|e| AppError::Llm(format!("Language detection failed: {e}")))?;

        let normalized = code
            .trim()
            .lines()
            .next()
            .unwrap_or("en")
            .chars()
            .filter(|c| c.is_ascii_alphabetic())
            .collect::<String>()
            .to_lowercase();

        if normalized.len() >= 2 {
            Ok(normalized[..2].to_string())
        } else {
            Ok("en".to_string())
        }
    }

    async fn translate_text(
        &self,
        client: &openai::CompletionsClient,
        source_language: &str,
        target_language: &str,
        text: &str,
        extra_instruction: &str,
    ) -> Result<String, AppError> {
        let translator = client
            .agent(&self.config.translation_model)
            .preamble(
                "You are a professional translation engine. Produce fluent, grammatically correct target-language text with natural wording and correct diacritics. Preserve meaning, line breaks, URLs, codes, dates, and numbers exactly. Output only translated text.",
            )
            .build();

        let prompt = format!(
            "Source language: {source_language}\nTarget language: {target_language}\n{extra_instruction}\nText:\n{text}"
        );

        translator
            .prompt(&prompt)
            .await
            .map_err(|e| AppError::Llm(format!("Translation failed: {e}")))
    }
}
