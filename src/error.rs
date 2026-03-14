//! Domain error types for the CLI orchestrator.

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Scraper gRPC error: {0}")]
    Scraper(#[from] tonic::Status),

    #[error("Agent gRPC error: {0}")]
    Agent(String),

    #[error("gRPC transport error: {0}")]
    Transport(#[from] tonic::transport::Error),
}
