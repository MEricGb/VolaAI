//! Destination identification tool — calls the Featherless vision API inline.
//!
//! This tool is used when the user shares a scenic travel photo and wants to
//! know which place, city, country, or landmark is shown.

use std::io::Cursor;

use base64::Engine as _;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use rig::{completion::ToolDefinition, tool::Tool};
use serde::{Deserialize, Serialize};

const SYSTEM_PROMPT: &str = "\
You are a travel destination recognition expert.

Given a photo, identify the most likely travel destination shown.

Respond with a JSON object containing exactly these keys:
  \"city\"       : city name or null if not recognizable
  \"country\"    : country name or null if not recognizable
  \"landmark\"   : specific landmark/place name or null if not recognizable
  \"confidence\" : one of \"high\", \"medium\", \"low\"
  \"reasoning\"  : one concise sentence explaining your identification

Output only the raw JSON object — no markdown, no commentary.";

#[derive(Debug, Deserialize)]
pub struct IdentifyDestinationArgs {
    #[allow(dead_code)]
    pub session_id: String,
    pub image_source: String,
}

#[derive(Debug, Serialize)]
pub struct IdentifyDestinationOutput {
    pub city: Option<String>,
    pub country: Option<String>,
    pub landmark: Option<String>,
    pub confidence: String,
    pub reasoning: String,
}

#[derive(Debug, thiserror::Error)]
pub enum DestinationIdToolError {
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Failed to read image file: {0}")]
    Io(#[from] std::io::Error),
    #[error("Failed to decode image: {0}")]
    Image(#[from] image::ImageError),
    #[error("Vision API error (HTTP {status}): {body}")]
    Api { status: u16, body: String },
    #[error("Failed to parse response: {0}")]
    Parse(String),
}

#[derive(Clone)]
pub struct DestinationIdTool {
    api_key:      String,
    base_url:     String,
    vision_model: String,
    http:         reqwest::Client,
}

impl DestinationIdTool {
    pub fn new(api_key: String, base_url: String, vision_model: String) -> Self {
        Self {
            api_key,
            base_url,
            vision_model,
            http: reqwest::Client::new(),
        }
    }
}

impl Tool for DestinationIdTool {
    const NAME: &'static str = "identify_destination";

    type Error = DestinationIdToolError;
    type Args = IdentifyDestinationArgs;
    type Output = IdentifyDestinationOutput;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Identify which travel destination, city, landmark, or country is shown \
                          in a photo or image. Use this when the user shares a scenic travel \
                          photo, holiday picture, or asks where a place is. Do NOT use this \
                          for booking confirmations or document screenshots."
                .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "The conversation session identifier"
                    },
                    "image_source": {
                        "type": "string",
                        "description": "Absolute/relative path to a local image file, or an http(s) URL"
                    }
                },
                "required": ["session_id", "image_source"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let image_content = build_image_content(&self.http, &args.image_source).await?;

        let payload = serde_json::json!({
            "model": self.vision_model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        image_content,
                        {"type": "text", "text": "Where is this place? Identify the travel destination."}
                    ]
                }
            ],
            "max_tokens": 256,
            "temperature": 0.0
        });

        let resp = self.http
            .post(format!("{}/chat/completions", self.base_url))
            .bearer_auth(&self.api_key)
            .json(&payload)
            .send()
            .await?;

        let status = resp.status().as_u16();
        if status != 200 {
            let body = resp.text().await.unwrap_or_default();
            return Err(DestinationIdToolError::Api { status, body });
        }

        let data: serde_json::Value = resp.json().await?;
        let raw = data["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();

        parse_response(&raw)
    }
}

async fn build_image_content(
    http: &reqwest::Client,
    image_source: &str,
) -> Result<serde_json::Value, DestinationIdToolError> {
    let bytes = if image_source.starts_with("http://") || image_source.starts_with("https://") {
        http.get(image_source)
            .header(reqwest::header::USER_AGENT, "vibehack-2026-agent/1.0 (+travel-assistant)")
            .header(reqwest::header::ACCEPT, "image/*,*/*;q=0.8")
            .send()
            .await?
            .bytes()
            .await?
            .to_vec()
    } else {
        tokio::fs::read(image_source).await?
    };

    let normalized = normalize_image_bytes(&bytes)?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(normalized);
    let data_url = format!("data:image/jpeg;base64,{b64}");

    Ok(serde_json::json!({
        "type": "image_url",
        "image_url": {"url": data_url}
    }))
}

fn normalize_image_bytes(bytes: &[u8]) -> Result<Vec<u8>, DestinationIdToolError> {
    let image = image::load_from_memory(bytes)?;
    let resized = if image.width() > 1400 || image.height() > 1400 {
        image.resize(1400, 1400, FilterType::Lanczos3)
    } else {
        image
    };

    let rgb = resized.to_rgb8();
    let mut output = Vec::new();
    let mut cursor = Cursor::new(&mut output);
    let mut encoder = JpegEncoder::new_with_quality(&mut cursor, 85);
    encoder.encode(
        &rgb,
        rgb.width(),
        rgb.height(),
        image::ExtendedColorType::Rgb8,
    )?;
    Ok(output)
}

fn parse_response(raw: &str) -> Result<IdentifyDestinationOutput, DestinationIdToolError> {
    let text = raw.trim();
    let cleaned = if text.starts_with("```") {
        text.lines()
            .filter(|line| !line.starts_with("```"))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        text.to_string()
    };

    let value: serde_json::Value = serde_json::from_str(&cleaned)
        .map_err(|err| DestinationIdToolError::Parse(format!("{err}: {raw}")))?;

    Ok(IdentifyDestinationOutput {
        city: value["city"].as_str().map(str::to_string),
        country: value["country"].as_str().map(str::to_string),
        landmark: value["landmark"].as_str().map(str::to_string),
        confidence: value["confidence"].as_str().unwrap_or("low").to_string(),
        reasoning: value["reasoning"].as_str().unwrap_or("").to_string(),
    })
}