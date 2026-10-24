<script lang="ts">
  import { editor } from "../app/editor.svelte";
  import { m } from "../paraglide/messages.js";
</script>

<nav aria-label={m.flows_title()}>
  <h2>{m.flows_title()}</h2>
  {#if editor.flowNames.length === 0}
    <p class="none">{m.flows_none()}</p>
  {/if}
  <ul>
    {#each editor.flowNames as name (name)}
      <li>
        <button
          type="button"
          class:current={name === editor.flowName}
          aria-current={name === editor.flowName ? "true" : undefined}
          onclick={() => {
            editor.selectFlow(name);
          }}
        >
          {name}
        </button>
      </li>
    {/each}
  </ul>
  <button
    type="button"
    class="new"
    onclick={() => {
      editor.createFlow();
    }}
  >
    {m.flows_new()}
  </button>
</nav>

<style>
  nav {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
  }
  h2 {
    margin: 0;
    color: var(--muted);
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  ul {
    display: grid;
    gap: 0.125rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  button {
    width: 100%;
    padding: 0.3125rem 0.625rem;
    border: 1px solid transparent;
    border-radius: 0.375rem;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  button:hover {
    background: var(--surface-2);
  }
  button.current {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }
  button.new {
    border-color: var(--border);
    color: var(--muted);
  }
  .none {
    margin: 0;
    color: var(--muted);
    font-size: 0.8125rem;
  }
</style>
