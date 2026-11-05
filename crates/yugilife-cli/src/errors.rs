use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    ArgumentError,
    CliInterrupted,
    InputInvalid,
    InputJsonInvalid,
    InputReadFailed,
    InternalError,
    OutputInvalid,
    OutputWriteFailed,
    RenderFailed,
    RenderValidationFailed,
    TemplateInvalid,
    TemplateNotFound,
    TemplateNotInstalled,
    TemplateRegistryUnavailable,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ArgumentError => "ARGUMENT_ERROR",
            Self::CliInterrupted => "CLI_INTERRUPTED",
            Self::InputInvalid => "INPUT_INVALID",
            Self::InputJsonInvalid => "INPUT_JSON_INVALID",
            Self::InputReadFailed => "INPUT_READ_FAILED",
            Self::InternalError => "INTERNAL_ERROR",
            Self::OutputInvalid => "OUTPUT_INVALID",
            Self::OutputWriteFailed => "OUTPUT_WRITE_FAILED",
            Self::RenderFailed => "RENDER_FAILED",
            Self::RenderValidationFailed => "RENDER_VALIDATION_FAILED",
            Self::TemplateInvalid => "TEMPLATE_INVALID",
            Self::TemplateNotFound => "TEMPLATE_NOT_FOUND",
            Self::TemplateNotInstalled => "TEMPLATE_NOT_INSTALLED",
            Self::TemplateRegistryUnavailable => "TEMPLATE_REGISTRY_UNAVAILABLE",
        }
    }

    pub fn exit_code(self) -> i32 {
        match self {
            Self::ArgumentError | Self::OutputInvalid => 2,
            Self::CliInterrupted => 130,
            _ => 1,
        }
    }
}

#[derive(Debug)]
pub struct CliError {
    pub code: ErrorCode,
    pub message: String,
}

impl CliError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
}

impl fmt::Display for CliError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "yugilife-cli [{}]: {}", self.code.as_str(), self.message)
    }
}

impl From<yugilife_core::Error> for CliError {
    fn from(error: yugilife_core::Error) -> Self {
        match error {
            yugilife_core::Error::Aborted => Self::new(ErrorCode::CliInterrupted, "The render was aborted."),
            yugilife_core::Error::Validation(message) => Self::new(ErrorCode::RenderValidationFailed, message),
            other => Self::new(ErrorCode::RenderFailed, other.message()),
        }
    }
}

pub type CliResult<T> = Result<T, CliError>;
