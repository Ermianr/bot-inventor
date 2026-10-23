use std::fmt;

use graph::{FlowName, NodeId};

/// How serious a diagnostic is. Only an error stops a project from compiling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Severity {
    Error,
    Warning,
}

macro_rules! codes {
    ($($(#[$doc:meta])* $name:ident => $text:literal, $severity:ident;)*) => {
        /// What a diagnostic is about. The text of a code is stable: tools and tests may match it.
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub enum Code {
            $($(#[$doc])* $name,)*
        }

        impl Code {
            /// Every code, in declaration order.
            pub const ALL: &'static [Code] = &[$(Code::$name,)*];

            /// The stable text of the code.
            #[must_use]
            pub fn as_str(self) -> &'static str {
                match self {
                    $(Code::$name => $text,)*
                }
            }

            #[must_use]
            pub fn severity(self) -> Severity {
                match self {
                    $(Code::$name => Severity::$severity,)*
                }
            }
        }
    };
}

codes! {
    // Limits of compile itself.
    TooManyFlowNodes => "too-many-flow-nodes", Error;
    TooManyFlowLines => "too-many-flow-lines", Error;
    // Structure.
    UnknownNodeType => "unknown-node-type", Error;
    UnknownTypeVersion => "unknown-type-version", Error;
    DuplicateNodeId => "duplicate-node-id", Error;
    DuplicateAlias => "duplicate-alias", Error;
    LineFromUnknownNode => "line-from-unknown-node", Error;
    LineToUnknownNode => "line-to-unknown-node", Error;
    UnknownPort => "unknown-port", Error;
    LineIntoTrigger => "line-into-trigger", Error;
    DuplicateLine => "duplicate-line", Error;
    NoTrigger => "no-trigger", Error;
    MultipleTriggers => "multiple-triggers", Error;
    UnreachableNode => "unreachable-node", Error;
    Cycle => "cycle", Error;
    // Settings.
    MissingField => "missing-field", Error;
    UnknownField => "unknown-field", Error;
    WrongType => "wrong-type", Error;
    OutOfRange => "out-of-range", Error;
    NotInChoices => "not-in-choices", Error;
    UnsafeAssetPath => "unsafe-asset-path", Error;
    // Expressions.
    InvalidExpression => "invalid-expression", Error;
    IncompleteReference => "incomplete-reference", Error;
    UnknownEventField => "unknown-event-field", Error;
    UnknownStep => "unknown-step", Error;
    UnknownOutput => "unknown-output", Error;
    StepNotBefore => "step-not-before", Error;
    StepSometimes => "step-sometimes", Warning;
    UnknownVariable => "unknown-variable", Error;
    UnknownErrorField => "unknown-error-field", Error;
    ErrorOutsideErrorPath => "error-outside-error-path", Error;
    ErrorSometimes => "error-sometimes", Warning;
    // Variables.
    DuplicateVariable => "duplicate-variable", Error;
    InitialTypeMismatch => "initial-type-mismatch", Error;
    // Discord limits.
    InvalidCommandName => "invalid-command-name", Error;
    InvalidDescription => "invalid-description", Error;
    TooManyOptions => "too-many-options", Error;
    DuplicateOption => "duplicate-option", Error;
    OptionOrder => "option-order", Error;
    CommandTooLarge => "command-too-large", Error;
    DuplicateCommand => "duplicate-command", Error;
    TooManyCommands => "too-many-commands", Error;
    // Output.
    InvalidPayload => "invalid-payload", Error;
}

/// One finding of compile, with where it is: the flow, the node and the path of the field, so the
/// editor can mark the exact field.
///
/// A message names the field and the limit; it never carries the value of a setting.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Diagnostic {
    /// `None` for a rule about the project as a whole.
    pub flow: Option<FlowName>,
    /// `None` for a rule about a flow as a whole.
    pub node: Option<NodeId>,
    /// The path inside the node (`content`, `options[0].name`) or `lines[2]` for a line.
    pub path: Option<String>,
    pub code: Code,
    pub message: String,
}

impl Diagnostic {
    #[must_use]
    pub fn severity(&self) -> Severity {
        self.code.severity()
    }

    #[must_use]
    pub fn is_error(&self) -> bool {
        self.severity() == Severity::Error
    }
}

impl fmt::Display for Diagnostic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let level = match self.severity() {
            Severity::Error => "error",
            Severity::Warning => "warning",
        };
        write!(f, "{level}[{}]", self.code.as_str())?;
        if let Some(flow) = &self.flow {
            write!(f, " flow `{}`", flow.as_str())?;
        }
        if let Some(node) = &self.node {
            write!(f, " node `{}`", node.as_str())?;
        }
        if let Some(path) = &self.path {
            write!(f, " field `{path}`")?;
        }
        write!(f, ": {}", self.message)
    }
}

/// A short prefix of text the author wrote (a name, a key), so a message stays short.
pub(super) fn clip(text: &str) -> String {
    const MAX: usize = 48;
    if text.chars().count() <= MAX {
        text.to_owned()
    } else {
        let mut clipped: String = text.chars().take(MAX).collect();
        clipped.push('…');
        clipped
    }
}
