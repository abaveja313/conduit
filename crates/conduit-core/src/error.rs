use thiserror::Error;

/// Canonical errors for conduit core
#[derive(Error, Debug)]
pub enum Error {
    #[error("staging not active")]
    StagingNotActive,

    #[error("staging already active")]
    StagingAlreadyActive,

    #[error("file not found: {0}")]
    FileNotFound(String),

    #[error("invalid path provided: {0}")]
    InvalidPath(String),
}

pub type Result<T> = std::result::Result<T, Error>;
