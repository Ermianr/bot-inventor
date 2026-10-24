<script lang="ts">
  import type { NameInfo } from "../lib/bindings";

  // CodeMirror is loaded the first time an expression is shown, not with the rest of the app.
  let {
    value,
    label,
    names = [],
    invalid = false,
    onchange,
  }: {
    value: string;
    label: string;
    names?: readonly NameInfo[];
    invalid?: boolean;
    onchange: (text: string) => void;
  } = $props();
</script>

{#await import("./CodeEditor.svelte") then { default: CodeEditor }}
  <CodeEditor {value} {label} {names} {invalid} {onchange} />
{/await}
