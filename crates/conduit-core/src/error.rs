use grep_searcher::SinkError;
use thiserror::Error;

/// Canonical errors for conduit core
#[derive(Error, Debug)]
pub enum Error {
    // -------- FS / Index --------
    #[error("staging not active")]
    StagingNotActive,

    #[error("staging already active")]
    StagingAlreadyActive,

    #[error("file not found: {0}")]
    FileNotFound(String),

    #[error("invalid path provided: {0}")]
    InvalidPath(String),

    // -------- Search / Replace / Preview --------
    #[error("invalid range: [{0}, {1})")]
    InvalidRange(usize, usize),

    #[error("operation aborted")]
    Aborted,

    #[error("encoding conversion failed")]
    Encoding,

    // -------- Wrapped sources --------
    #[error(transparent)]
    Regex(#[from] regex::Error),

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Glob(#[from] globset::Error),

    #[error(transparent)]
    Grep(#[from] grep_regex::Error),

    // todo: do we really need this?
    #[error(transparent)]
    GrepMatcher(#[from] grep_matcher::NoError),

    #[error("pattern error: {0}")]
    Pattern(String),

    #[error("no replacement found at ({0}, {1})")]
    NoReplacementFound(usize, usize),
}

impl SinkError for Error {
    fn error_message<T: std::fmt::Display>(message: T) -> Self {
        Error::Pattern(message.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
