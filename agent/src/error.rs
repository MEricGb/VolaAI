//! Application-level error types for the agent service.

/// All failure modes in the agent service.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// gRPC status error from the scraper service.
    #[error("Scraper gRPC error: {0}")]
    Scraper(Box<tonic::Status>),

    /// Transport-level error connecting to scraper.
    #[error("Transport error: {0}")]
    Transport(Box<tonic::transport::Error>),

    /// LLM provider error.
    #[error("LLM error: {0}")]
    Llm(String),

    /// Configuration error.
    #[error("Config error: {0}")]
    Config(#[from] anyhow::Error),

    /// Scraper returned a well-formed response but the oneof result field was unset.
    #[error("Unexpected response from scraper: missing result field")]
    UnexpectedResponse,
}

impl From<tonic::Status> for AppError {
    fn from(value: tonic::Status) -> Self {
        Self::Scraper(Box::new(value))
    }
}

impl From<tonic::transport::Error> for AppError {
    fn from(value: tonic::transport::Error) -> Self {
        Self::Transport(Box::new(value))
    }
}

impl From<AppError> for tonic::Status {
    fn from(e: AppError) -> Self {
        tonic::Status::internal(e.to_string())
    }
}
