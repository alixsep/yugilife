use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    Validation(String),
    Render(String),
    Range(String),
    Aborted,
}

pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    pub fn render(message: impl Into<String>) -> Self {
        Self::Render(message.into())
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::Validation(message.into())
    }

    pub fn range(message: impl Into<String>) -> Self {
        Self::Range(message.into())
    }

    pub fn message(&self) -> &str {
        match self {
            Self::Validation(message) | Self::Render(message) | Self::Range(message) => message,
            Self::Aborted => "Rendering was aborted.",
        }
    }

    pub fn is_validation(&self) -> bool {
        matches!(self, Self::Validation(_))
    }
}

impl fmt::Display for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.message())
    }
}

impl std::error::Error for Error {}
