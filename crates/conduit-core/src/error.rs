use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("staging not active")]
    StagingNotActive,

    #[error("staging already active")]
    StagingAlreadyActive,
}

pub type Result<T> = std::result::Result<T, Error>;
