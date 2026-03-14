//! OCR booking extraction tool — wraps the Python OCR service as a rig [`Tool`].
//!
//! The LLM calls this tool when the user provides a booking screenshot/image path
//! and wants extracted travel details.

pub mod client;

use std::sync::Arc;

use rig::{completion::ToolDefinition, tool::Tool};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use client::OcrClient;

/// Arguments the LLM passes when invoking the extract_booking_info tool.
#[derive(Debug, Deserialize)]
pub struct ExtractBookingArgs {
    pub session_id: String,
    pub image_path: String,
}

/// Serializable output returned to the LLM after tool execution.
#[derive(Debug, Serialize)]
pub struct ExtractBookingOutput {
    pub summary: String,
    pub comparison_query_json: Option<String>,
}

/// Errors that can occur during OCR tool execution.
#[derive(Debug, thiserror::Error)]
pub enum OcrToolError {
    #[error("OCR call failed: {0}")]
    Rpc(#[from] AppError),
}

/// rig tool that extracts booking info from screenshot images.
#[derive(Clone)]
pub struct OcrTool {
    client: Arc<OcrClient>,
}

impl OcrTool {
    pub fn new(client: Arc<OcrClient>) -> Self {
        Self { client }
    }
}

impl Tool for OcrTool {
    const NAME: &'static str = "extract_booking_info";

    type Error = OcrToolError;
    type Args = ExtractBookingArgs;
    type Output = ExtractBookingOutput;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Extract structured booking details from a travel confirmation screenshot \
                          such as a plane ticket, hotel reservation, or itinerary. Use this when \
                          the image looks like a document or booking confirmation rather than a scenic photo."
                .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "The conversation session identifier"
                    },
                    "image_path": {
                        "type": "string",
                        "description": "Absolute or relative path to the booking screenshot image"
                    }
                },
                "required": ["session_id", "image_path"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let response = self
            .client
            .extract_booking_info(args.session_id, args.image_path, "featherless".to_string())
            .await?;

        if !response.success {
            let error = response.error.unwrap_or_else(|| "OCR extraction failed".to_string());
            let summary = format!("OCR extraction failed: {error}");
            return Ok(ExtractBookingOutput {
                summary,
                comparison_query_json: None,
            });
        }

        Ok(ExtractBookingOutput {
            summary: response.summary,
            comparison_query_json: response.comparison_query_json,
        })
    }
}
