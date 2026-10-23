/// Why an expression or template could not be compiled or evaluated.
///
/// Messages never carry values from the scope, because those may be text written by Discord
/// users; they name the problem and, where it helps the author, the names in the source.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ExprError {
    #[error("the expression is empty")]
    Empty,
    #[error("the source is {len} bytes long; the limit is {max}")]
    SourceTooLong { len: usize, max: usize },
    #[error("syntax error: {0}")]
    Syntax(String),
    #[error("the expression is too complex: {0}")]
    TooComplex(&'static str),
    #[error("not supported: {0}")]
    Unsupported(&'static str),
    #[error("unknown name `{0}`; an expression reads `event`, `steps`, `vars` or `error`")]
    UnknownName(String),
    #[error("the function `{0}` is not available")]
    UnknownFunction(String),
    #[error("`{{{{` at byte {offset} is never closed")]
    UnclosedSegment { offset: usize },
    #[error("evaluation failed: {0}")]
    Evaluation(String),
    #[error("the scope is too large: {0}")]
    ScopeTooLarge(&'static str),
    #[error("the result is too large")]
    ResultTooLarge,
    #[error("the result cannot be used as data: {0}")]
    UnsupportedResult(&'static str),
}
