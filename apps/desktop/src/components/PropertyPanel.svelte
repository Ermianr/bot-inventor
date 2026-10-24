<script lang="ts">
  import { editor } from "../app/editor.svelte";
  import { findSpec } from "../editor/ops";
  import { nodeLabel } from "../editor/labels";
  import { m } from "../paraglide/messages.js";
  import AliasField from "./AliasField.svelte";
  import FieldControls from "./FieldControls.svelte";

  const node = $derived.by(() => {
    const [id, ...others] = editor.selected;
    if (id === undefined || others.length > 0) return undefined;
    return editor.flow?.nodes.find((n) => n.id === id);
  });
  const many = $derived(editor.selected.length > 1);
  const spec = $derived(
    node === undefined
      ? undefined
      : findSpec(editor.catalog, node.type, node.type_version),
  );
  const own = $derived(
    node === undefined ? [] : (editor.marks.nodes.get(node.id) ?? []),
  );
</script>

<aside aria-label={m.panel_title()}>
  <h2>{m.panel_title()}</h2>
  {#if node === undefined}
    <p class="hint">{many ? m.panel_hint_many() : m.panel_hint()}</p>
  {:else}
    {#key node.id}
      {@const id = node.id}
      <p class="type">{m.panel_type()}: {nodeLabel(node.type)}</p>
      {#each own as problem, index (index)}
        <p class="problem" class:warning={problem.severity === "warning"}>
          {problem.message}
        </p>
      {/each}
      <AliasField {id} alias={node.alias} />
      {#if spec !== undefined}
        <FieldControls fields={spec.fields} nodeId={id} />
      {/if}
    {/key}
  {/if}
</aside>

<style>
  aside {
    padding: 0.75rem;
    overflow-y: auto;
    border-left: 1px solid var(--border);
    background: var(--surface);
  }
  h2 {
    margin: 0 0 0.75rem;
    color: var(--muted);
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .hint,
  .type {
    margin: 0 0 0.75rem;
    color: var(--muted);
  }
  .problem {
    margin: 0 0 0.75rem;
    color: var(--danger);
    font-size: 0.75rem;
  }
  .problem.warning {
    color: var(--warning);
  }
</style>
