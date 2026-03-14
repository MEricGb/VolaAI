//! Agent gRPC microservice — wraps rig + Featherless to compose LLM replies.

mod config;

pub mod agent_proto {
    tonic::include_proto!("agent");
}

use std::sync::Arc;

use anyhow::Result;
use rig::client::CompletionClient;
use rig::completion::Prompt;
use rig::providers::openai;
use tonic::{transport::Server, Request, Response, Status};
use tracing::{info, instrument};

use agent_proto::{
    agent_service_server::{AgentService, AgentServiceServer},
    ChatRequest, ChatResponse,
};
use config::Config;

// ── gRPC service implementation ───────────────────────────────────────────────

struct AgentServiceImpl {
    config: Arc<Config>,
}

#[tonic::async_trait]
impl AgentService for AgentServiceImpl {
    #[instrument(skip(self, request), fields(service = "agent"))]
    async fn chat(
        &self,
        request: Request<ChatRequest>,
    ) -> Result<Response<ChatResponse>, Status> {
        let req = request.into_inner();

        info!(user_message = %req.user_message, "Received chat request");

        let client = openai::CompletionsClient::builder()
            .api_key(self.config.featherless_api_key.clone())
            .base_url(&self.config.featherless_base_url)
            .build()
            .map_err(|e| Status::internal(format!("LLM client error: {e}")))?;

        let agent = client
            .agent(&self.config.featherless_model)
            .preamble(
                "You are a friendly flight search assistant. \
                 A tool has already processed the user's request. \
                 Present the information naturally and helpfully. \
                 If it's a clarification question, ask it conversationally. \
                 If flights were found, highlight the best options clearly.",
            )
            .build();

        let prompt = if req.tool_context.is_empty() {
            req.user_message.clone()
        } else {
            format!(
                "User message: {}\n\nFlight search result:\n{}",
                req.user_message, req.tool_context
            )
        };

        let reply = agent
            .prompt(&prompt)
            .await
            .map_err(|e| Status::internal(format!("LLM error: {e}")))?;

        Ok(Response::new(ChatResponse { reply }))
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "agent=info,warn".parse().unwrap()),
        )
        .init();

    let config = Arc::new(Config::from_env()?);
    let addr = format!("[::1]:{}", config.grpc_port).parse()?;

    info!(%addr, "Agent gRPC server starting");

    Server::builder()
        .add_service(AgentServiceServer::new(AgentServiceImpl { config }))
        .serve(addr)
        .await?;

    Ok(())
}
