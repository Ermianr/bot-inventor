<script lang="ts">
  import type { NodeSpec } from "../lib/bindings";
  import { nodeLabel } from "../editor/labels";
  import { m } from "../paraglide/messages.js";

  let {
    catalog,
    onadd,
  }: { catalog: readonly NodeSpec[]; onadd: (spec: NodeSpec) => void } =
    $props();
</script>

<section aria-label={m.palette_title()}>
  <h2>{m.palette_title()}</h2>
  <ul>
    {#each catalog as spec (`${spec.type_id}@${spec.version}`)}
      <li>
        <button type="button" onclick={() => onadd(spec)}>
          {nodeLabel(spec.type_id)}
        </button>
      </li>
    {/each}
  </ul>
</section>

<style>
  section {
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface);
    box-shadow: 0 1px 4px var(--shadow);
  }
  h2 {
    margin: 0 0 0.375rem;
    color: var(--muted);
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  ul {
    display: grid;
    gap: 0.25rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  button {
    width: 100%;
    padding: 0.3125rem 0.625rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  button:hover {
    border-color: var(--accent);
  }
</style>
