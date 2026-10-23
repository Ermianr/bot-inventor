//! Provisional limits (`docs/ARCHITECTURE.md` §6), to be measured.

/// Longest expression source, in bytes.
pub const MAX_SOURCE_BYTES: usize = 2048;
/// Longest template source, in bytes.
pub const MAX_TEMPLATE_BYTES: usize = 16 * 1024;
/// Most syntax nodes in one expression.
pub const MAX_NODES: usize = 512;
/// Deepest nesting of one expression, in syntax nodes and in brackets.
pub const MAX_DEPTH: usize = 64;
/// Most operators, `.` and call or index brackets in one expression (see `lex::chaining_characters`).
pub const MAX_OPERATORS: usize = 256;
/// Most macros (`all`, `exists`, `map`, `filter`, …) nested inside one another. Each level
/// multiplies the work by the length of a list.
pub const MAX_COMPREHENSION_NESTING: usize = 2;

/// Most text bytes (strings and map keys) in a scope.
pub const MAX_SCOPE_BYTES: usize = 128 * 1024;
/// Most values (numbers, strings, lists, maps, …) in a scope.
pub const MAX_SCOPE_ITEMS: usize = 4096;
/// Most elements in one list or map of a scope.
pub const MAX_COLLECTION_LEN: usize = 1024;
/// Deepest nesting of lists and maps in a scope.
pub const MAX_SCOPE_DEPTH: usize = 16;

/// Largest result of one expression, in bytes of text.
pub const MAX_RESULT_BYTES: usize = 64 * 1024;
