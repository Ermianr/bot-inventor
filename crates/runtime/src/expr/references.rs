use std::collections::BTreeSet;
use std::fmt;

/// The four names an expression may read (`docs/ARCHITECTURE.md` §4.2).
pub const ROOTS: [&str; 4] = ["event", "steps", "vars", "error"];

/// A name read by an expression, as its segments: `event.user.id` is `["event", "user", "id"]`.
///
/// The path stops where the name stops being fixed: in `event.options[k]` it is
/// `event.options`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Path(Vec<String>);

impl Path {
    pub(super) fn new(segments: Vec<String>) -> Self {
        Self(segments)
    }

    pub fn segments(&self) -> &[String] {
        &self.0
    }

    /// The namespace: `event`, `steps`, `vars` or `error`.
    pub fn root(&self) -> &str {
        self.0.first().map_or("", String::as_str)
    }
}

impl fmt::Display for Path {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0.join("."))
    }
}

/// What an expression or template reads and calls.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct References {
    paths: BTreeSet<Path>,
    functions: BTreeSet<String>,
}

impl References {
    pub(super) fn insert_path(&mut self, path: Path) {
        self.paths.insert(path);
    }

    pub(super) fn insert_function(&mut self, name: String) {
        self.functions.insert(name);
    }

    pub(super) fn extend(&mut self, other: &References) {
        self.paths.extend(other.paths.iter().cloned());
        self.functions.extend(other.functions.iter().cloned());
    }

    /// The names read, longest fixed path each, sorted.
    pub fn paths(&self) -> impl Iterator<Item = &Path> {
        self.paths.iter()
    }

    /// The named functions and methods called, sorted. Operators are not listed.
    pub fn functions(&self) -> impl Iterator<Item = &str> {
        self.functions.iter().map(String::as_str)
    }

    /// Whether the namespace is read at all.
    pub fn reads(&self, root: &str) -> bool {
        self.paths.iter().any(|path| path.root() == root)
    }
}
