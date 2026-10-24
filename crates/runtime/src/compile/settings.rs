//! Checks the settings of a node against its schema.

use graph::{FlowName, Node};
use serde_json::{Map, Value};

use super::diagnostic::{Code, Diagnostic, clip};
use crate::catalog::{FieldKind, FieldSpec, NodeSpec};

/// A setting that holds an expression or a template, to be compiled by the next pass.
pub(super) struct ExpressionField {
    /// The path of the field inside the settings, such as `content`.
    pub path: String,
    pub source: String,
    /// A template (text with `{{ }}` segments) rather than one expression.
    pub template: bool,
}

pub(super) struct Checked {
    pub expressions: Vec<ExpressionField>,
    /// The paths inside `assets/` that the settings reference.
    pub assets: Vec<String>,
    /// The settings match the schema.
    pub ok: bool,
}

pub(super) fn check(
    flow: &FlowName,
    node: &Node,
    spec: &NodeSpec,
    out: &mut Vec<Diagnostic>,
) -> Checked {
    let mut cx = Cx {
        flow,
        node,
        out,
        errors: 0,
        expressions: Vec::new(),
        assets: Vec::new(),
    };
    cx.object(&node.settings, spec.fields, "");
    Checked {
        expressions: cx.expressions,
        assets: cx.assets,
        ok: cx.errors == 0,
    }
}

struct Cx<'a> {
    flow: &'a FlowName,
    node: &'a Node,
    out: &'a mut Vec<Diagnostic>,
    errors: usize,
    expressions: Vec<ExpressionField>,
    assets: Vec<String>,
}

fn join(prefix: &str, name: &str) -> String {
    if prefix.is_empty() {
        name.to_owned()
    } else {
        format!("{prefix}.{name}")
    }
}

fn kind_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "a boolean",
        Value::Number(_) => "a number",
        Value::String(_) => "text",
        Value::Array(_) => "a list",
        Value::Object(_) => "an object",
    }
}

impl Cx<'_> {
    fn push(&mut self, path: String, code: Code, message: String) {
        self.errors += 1;
        self.out.push(Diagnostic {
            flow: Some(self.flow.clone()),
            node: Some(self.node.id.clone()),
            path: Some(path),
            code,
            message,
        });
    }

    fn wrong_type(&mut self, path: String, expected: &str, found: &Value) {
        let message = format!("expected {expected}, found {}", kind_name(found));
        self.push(path, Code::WrongType, message);
    }

    fn object(&mut self, map: &Map<String, Value>, fields: &[FieldSpec], prefix: &str) {
        for field in fields {
            let path = join(prefix, field.name);
            match map.get(field.name) {
                None if field.required => {
                    self.push(
                        path,
                        Code::MissingField,
                        "this field is required".to_owned(),
                    );
                }
                None => {}
                Some(value) => self.value(value, field, path),
            }
        }
        for key in map.keys() {
            if !fields.iter().any(|field| field.name == key) {
                self.push(
                    join(prefix, &clip(key)),
                    Code::UnknownField,
                    "the node type has no such field".to_owned(),
                );
            }
        }
    }

    fn value(&mut self, value: &Value, field: &FieldSpec, path: String) {
        match &field.kind {
            FieldKind::Text { min, max, template } => {
                let Value::String(text) = value else {
                    return self.wrong_type(path, "text", value);
                };
                let length = text.chars().count();
                if length < *min || length > *max {
                    let message =
                        format!("the text must have {min} to {max} characters, it has {length}");
                    return self.push(path, Code::OutOfRange, message);
                }
                if *template {
                    self.expressions.push(ExpressionField {
                        path,
                        source: text.clone(),
                        template: true,
                    });
                }
            }
            FieldKind::Expression | FieldKind::Condition => {
                let Value::String(text) = value else {
                    return self.wrong_type(path, "the text of an expression", value);
                };
                self.expressions.push(ExpressionField {
                    path,
                    source: text.clone(),
                    template: false,
                });
            }
            FieldKind::Integer { min, max } => {
                let Some(number) = value.as_i64() else {
                    return self.wrong_type(path, "a whole number", value);
                };
                if number < *min || number > *max {
                    let message = format!("the number must be from {min} to {max}");
                    self.push(path, Code::OutOfRange, message);
                }
            }
            FieldKind::Boolean => {
                if !value.is_boolean() {
                    self.wrong_type(path, "a boolean", value);
                }
            }
            FieldKind::Choice(choices) => {
                let Value::String(text) = value else {
                    return self.wrong_type(path, "text", value);
                };
                if !choices.contains(&text.as_str()) {
                    let message = format!("the value must be one of: {}", choices.join(", "));
                    self.push(path, Code::NotInChoices, message);
                }
            }
            FieldKind::Asset => {
                let Value::String(text) = value else {
                    return self.wrong_type(path, "the path of a file in `assets/`", value);
                };
                match unsafe_asset_path(text) {
                    Some(reason) => self.push(path, Code::UnsafeAssetPath, reason.to_owned()),
                    None => self.assets.push(text.clone()),
                }
            }
            FieldKind::List { max, item } => {
                let Value::Array(items) = value else {
                    return self.wrong_type(path, "a list", value);
                };
                if items.len() > *max {
                    let message = format!("the list has {} items; the limit is {max}", items.len());
                    return self.push(path, Code::OutOfRange, message);
                }
                for (number, element) in items.iter().enumerate() {
                    let element_path = format!("{path}[{number}]");
                    match element {
                        Value::Object(map) => self.object(map, item, &element_path),
                        other => self.wrong_type(element_path, "an object", other),
                    }
                }
            }
        }
    }
}

/// Why a path cannot name a file inside `assets/`, or `None` when it can. The runner asks it
/// again for every asset of a payload, which may not have gone through compile.
#[must_use]
pub fn unsafe_asset_path(path: &str) -> Option<&'static str> {
    if path.is_empty() {
        return Some("the path is empty");
    }
    if path.len() > 255 {
        return Some("the path is longer than 255 bytes");
    }
    if path.starts_with('/') || path.contains(':') {
        return Some("the path must be relative to `assets/`");
    }
    if path.contains('\\') || path.chars().any(char::is_control) {
        return Some("the path has a backslash or a control character; separate folders with `/`");
    }
    if path
        .split('/')
        .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Some("the path has an empty part, `.` or `..`");
    }
    None
}
