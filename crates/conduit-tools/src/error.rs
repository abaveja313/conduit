//! error.rs — Error types for `conduit-tools`
//!
//! Purpose:
//! - Centralizes tool-level errors with readable messages.
//! - Provides the `ToolResult<T>` alias for convenience.

use thiserror::Error;

/// Errors that can occur within the tools layer.
#[derive(Error, Debug)]
pub enum ToolError {
    /// Regex compilation failed; includes the underlying `regex::Error`.
    #[error("regex compile failed: {0}")]
    InvalidRegex(#[from] regex::Error),

    /// Operation was cancelled via a shared `AbortFlag`.
    #[error("search aborted")]
    Aborted,

    /// Invalid range of bytes
    #[error("invalid range (start: {0}, end: {1}")]
    InvalidRange(usize, usize),
}

/// Convenience result alias for tool operations.
pub type ToolResult<T> = Result<T, ToolError>;
