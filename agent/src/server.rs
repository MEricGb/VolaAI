//! gRPC service handler for the agent service.
//!
//! This module is intentionally thin — it only marshals proto types and
//! delegates all business logic to [`OrchestrationEngine`].

use std::{
    collections::{HashMap, VecDeque},
    sync::Arc,
};

use tokio::sync::Mutex;
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
    pub(crate) sessions: Arc<Mutex<HashMap<String, SessionState>>>,
}

#[derive(Clone, Debug)]
pub(crate) struct ChatTurn {
    user: String,
    assistant: String,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct SessionState {
    turns: VecDeque<ChatTurn>,
}

const MAX_TURNS_PER_SESSION: usize = 8;
const MAX_CHARS_PER_TURN: usize = 1200;

#[tonic::async_trait]
impl AgentService for AgentServiceImpl {
    #[instrument(skip(self, request), fields(service = "agent"))]
    async fn chat(
        &self,
        request: Request<ChatRequest>,
    ) -> Result<Response<ChatResponse>, Status> {
        let req = request.into_inner();
        let session_id = if req.session_id.trim().is_empty() {
            "default".to_string()
        } else {
            req.session_id.clone()
        };

        // If the API provides structured context (DB-backed last-N messages),
        // use that directly to avoid double-wrapping and prompt leakage.
        let (contextual_message, user_for_state) = if let Some((history, current)) =
            parse_api_ctx_message(&req.user_message)
        {
            (
                build_contextual_message_from_parts(&history, &current),
                current,
            )
        } else {
            // Read session history without holding lock across network/LLM call.
            let state = {
                let sessions = self.sessions.lock().await;
                sessions.get(&session_id).cloned().unwrap_or_default()
            };
            (
                build_contextual_message(&state.turns, &req.user_message),
                req.user_message.clone(),
            )
        };

        let result = self
            .engine
            .process(
                &session_id,
                &contextual_message,
            )
            .await
            .map_err(Status::from)?;

        {
            let mut sessions = self.sessions.lock().await;
            let session = sessions.entry(session_id).or_default();
            session.turns.push_back(ChatTurn {
                user: clip_text(&user_for_state),
                assistant: clip_text(&result.reply),
            });
            while session.turns.len() > MAX_TURNS_PER_SESSION {
                session.turns.pop_front();
            }
        }

        Ok(Response::new(ChatResponse { reply: result.reply }))
    }
}

fn build_contextual_message(history: &VecDeque<ChatTurn>, user_message: &str) -> String {
    if history.is_empty() {
        return user_message.to_string();
    }

    let mut out = String::from(
        "Use this recent conversation context to resolve omitted details like routes, dates, and option numbers. Do not repeat it verbatim.\n",
    );
    out.push_str("Recent turns:\n");
    for turn in history {
        out.push_str("User: ");
        out.push_str(&turn.user);
        out.push('\n');
        out.push_str("Assistant: ");
        out.push_str(&turn.assistant);
        out.push('\n');
    }
    out.push_str("User: ");
    out.push_str(user_message);
    out
}

fn build_contextual_message_from_parts(history: &str, user_message: &str) -> String {
    let mut out = String::from(
        "Use this recent conversation context to resolve omitted details like routes, dates, and option numbers. Do not repeat it verbatim.\n",
    );
    let history = history.trim();
    if !history.is_empty() {
        out.push_str("Recent turns:\n");
        out.push_str(history);
        if !history.ends_with('\n') {
            out.push('\n');
        }
    }
    out.push_str("User: ");
    out.push_str(user_message.trim());
    out
}

fn parse_api_ctx_message(user_message: &str) -> Option<(String, String)> {
    // Payload format:
    // __API_CTX__
    // <<HISTORY>>
    // ...
    // <<USER>>
    // <current user message>
    let trimmed = user_message.trim();
    let after_prefix = trimmed.strip_prefix("__API_CTX__")?;
    let after_prefix = after_prefix.trim_start_matches('\n');
    let (history_part, current_part) = after_prefix.split_once("\n<<USER>>\n")?;

    let history = history_part
        .trim_start()
        .strip_prefix("<<HISTORY>>\n")
        .unwrap_or("")
        .trim_end()
        .to_string();

    let current = current_part.trim().to_string();
    if current.is_empty() {
        return None;
    }
    Some((history, current))
}

fn clip_text(text: &str) -> String {
    if text.chars().count() <= MAX_CHARS_PER_TURN {
        return text.to_string();
    }
    let clipped: String = text.chars().take(MAX_CHARS_PER_TURN).collect();
    format!("{}...", clipped)
}
