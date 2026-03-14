//! Tool registry for the agent orchestrator.
//!
//! Each sub-module implements one rig [`Tool`]. To add a new tool:
//! 1. Create `tools/<name>/mod.rs` implementing `rig::tool::Tool`
//! 2. Re-export it here
//! 3. Register it in `orchestrator/mod.rs` via `.tool()`

pub mod scraper;
pub mod ocr;

pub use scraper::ScraperTool;
pub use ocr::OcrTool;
