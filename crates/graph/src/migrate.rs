//! Migration of a project written in an older format version.
//!
//! A step works on the JSON of the whole project, before it becomes typed, so it can
//! rename or move fields that the current types no longer have.

use std::collections::BTreeMap;

use serde_json::Value;

/// The raw JSON of a project: the manifest and the flows by file stem.
#[derive(Debug)]
pub struct RawProject {
    pub manifest: Value,
    pub flows: BTreeMap<String, Value>,
}

/// One step: it turns the JSON of version `n` into the JSON of version `n + 1` and
/// leaves `format_version` to the caller.
pub type Step = fn(&mut RawProject);

/// `STEPS[i]` migrates version `i + 1` to `i + 2`. Version 1 is the first, so it is
/// empty. A new format version adds its step here and a sample in `tests/samples/`.
pub const STEPS: &[Step] = &[];

/// Applies the steps from version `from` up to the end of `steps`, and sets the
/// `format_version` of the manifest to the version reached. The caller has already
/// checked that `from` is between 1 and the version of `steps`.
pub fn migrate_with(steps: &[Step], raw: &mut RawProject, from: u32) {
    let first = usize::try_from(from.saturating_sub(1)).unwrap_or(usize::MAX);
    for step in steps.iter().skip(first) {
        step(raw);
    }
    let reached = u32::try_from(steps.len())
        .unwrap_or(u32::MAX)
        .saturating_add(1);
    if let Some(manifest) = raw.manifest.as_object_mut() {
        manifest.insert("format_version".to_owned(), Value::from(reached));
    }
}

/// Migrates to the current format version.
pub fn migrate(raw: &mut RawProject, from: u32) {
    migrate_with(STEPS, raw, from);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_steps_reach_the_current_version() {
        assert_eq!(
            u32::try_from(STEPS.len()).ok().map(|n| n + 1),
            Some(crate::model::CURRENT_FORMAT_VERSION)
        );
    }

    fn rename_name_to_title(raw: &mut RawProject) {
        if let Some(manifest) = raw.manifest.as_object_mut()
            && let Some(name) = manifest.remove("name")
        {
            manifest.insert("title".to_owned(), name);
        }
    }

    fn add_flag(raw: &mut RawProject) {
        if let Some(manifest) = raw.manifest.as_object_mut() {
            manifest.insert("flag".to_owned(), Value::Bool(true));
        }
    }

    #[test]
    fn steps_run_in_order_from_the_given_version() {
        let steps: &[Step] = &[rename_name_to_title, add_flag];
        let new = || RawProject {
            manifest: serde_json::json!({"format_version": 1, "name": "x"}),
            flows: BTreeMap::new(),
        };

        let mut from_one = new();
        migrate_with(steps, &mut from_one, 1);
        assert_eq!(
            from_one.manifest,
            serde_json::json!({"format_version": 3, "title": "x", "flag": true})
        );

        let mut from_two = new();
        migrate_with(steps, &mut from_two, 2);
        assert_eq!(
            from_two.manifest,
            serde_json::json!({"format_version": 3, "name": "x", "flag": true})
        );
    }
}
