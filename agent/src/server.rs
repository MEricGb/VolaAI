//! gRPC service handler for the agent service.
//!
//! This module is intentionally thin — it only marshals proto types and
//! delegates all business logic to [`OrchestrationEngine`].

use std::sync::Arc;

use tonic::{Request, Response, Status};
use tracing::instrument;

use crate::{
    agent_proto::{
        agent_service_server::AgentService, ChatRequest, ChatResponse,
    },
    orchestrator::OrchestrationEngine,
};

/// gRPC service implementation. Holds a shared reference to the engine.
pub struct AgentServiceImpl {
    pub(crate) engine: Arc<OrchestrationEngine>,
}

#[tonic::async_trait]
impl AgentService for AgentServiceImpl {
    #[instrument(skip(self, request), fields(service = "agent"))]
    async fn chat(
        &self,
        request: Request<ChatRequest>,
    ) -> Result<Response<ChatResponse>, Status> {
        let req = request.into_inner();

        let reply = self
            .engine
            .process(&req.session_id, &req.user_message)
            .await
            .map_err(Status::from)?;

        Ok(Response::new(ChatResponse { reply }))
    }
}
