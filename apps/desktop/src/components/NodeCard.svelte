<script lang="ts">
  import { Handle, Position, type NodeProps } from "@xyflow/svelte";
  import type { CardData } from "../editor/canvas";
  import { nodeLabel, portLabel } from "../editor/labels";
  import { m } from "../paraglide/messages.js";

  let { data, selected }: NodeProps & { data: CardData } = $props();
</script>

<div
  class="card"
  class:selected
  class:trigger={data.isTrigger}
  class:unknown={!data.known}
>
  {#if !data.isTrigger}
    <Handle type="target" position={Position.Left} />
  {/if}
  <header>
    <span class="kind"
      >{data.known ? nodeLabel(data.type) : m.node_unknown()}</span
    >
    {#if data.isTrigger}<span class="badge">{m.node_trigger()}</span>{/if}
  </header>
  <p class="alias">{data.alias}</p>
  {#if !data.known}<p class="type">{data.type}</p>{/if}
  <ul>
    {#each data.ports as port (port)}
      <li class:error={port === "error"}>
        <span>{portLabel(port)}</span>
        <Handle type="source" position={Position.Right} id={port} />
      </li>
    {/each}
  </ul>
</div>

<style>
  .card {
    min-width: 11rem;
    padding: 0.5rem 0;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface);
    color: var(--text);
    font-size: 0.8125rem;
  }
  .card.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }
  .card.trigger {
    border-top: 3px solid var(--accent);
  }
  .card.unknown {
    border-style: dashed;
    border-color: var(--danger);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0 0.75rem;
    font-weight: 600;
  }
  .badge {
    padding: 0 0.375rem;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 0.6875rem;
    font-weight: 500;
  }
  .alias,
  .type {
    margin: 0.125rem 0 0;
    padding: 0 0.75rem;
    color: var(--muted);
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
  }
  ul {
    margin: 0.5rem 0 0;
    padding: 0;
    list-style: none;
  }
  li {
    position: relative;
    padding: 0.1875rem 0.75rem;
    text-align: right;
    color: var(--muted);
  }
  li.error {
    color: var(--danger);
  }
</style>
