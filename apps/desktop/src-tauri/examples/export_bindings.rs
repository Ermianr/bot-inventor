//! Writes `src/lib/bindings.ts`; run through `cargo xtask bindings`.

fn main() -> anyhow::Result<()> {
    desktop_lib::export_bindings(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../src/lib/bindings.ts"
    ))
}
