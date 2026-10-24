<script lang="ts">
  import { editor } from "../app/editor.svelte";
  import { m } from "../paraglide/messages.js";

  let { id, alias }: { id: string; alias: string } = $props();

  // svelte-ignore state_referenced_locally
  let draft = $state(alias);
  let error = $state<"invalid" | "taken" | "unknown-node" | null>(null);

  // The alias changed from outside (an undo, a redo): show it.
  $effect(() => {
    draft = alias;
    error = null;
  });

  // The text is checked as it is typed, but only a valid one that is confirmed (Enter, or leaving
  // the field) renames the node, so a name that is refused never changes the alias on the way.
  function commit(): void {
    if (editor.renameAlias(id, draft) !== null) {
      draft = alias;
      error = null;
    }
  }
</script>

<div class="field" class:invalid={error !== null}>
  <label for="alias-{id}">{m.panel_alias()}</label>
  <input
    id="alias-{id}"
    type="text"
    spellcheck="false"
    maxlength="64"
    value={draft}
    oninput={(event) => {
      draft = event.currentTarget.value;
      error = editor.checkAlias(id, draft);
    }}
    onchange={commit}
  />
  {#if error === "invalid"}
    <p class="problem">{m.alias_invalid()}</p>
  {:else if error === "taken"}
    <p class="problem">{m.alias_taken()}</p>
  {/if}
</div>

<style>
  .field {
    display: grid;
    gap: 0.25rem;
    margin-bottom: 0.75rem;
  }
  label {
    color: var(--muted);
    font-size: 0.75rem;
  }
  input {
    width: 100%;
    padding: 0.3125rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-family: ui-monospace, monospace;
  }
  .invalid input {
    border-color: var(--danger);
  }
  .problem {
    margin: 0;
    color: var(--danger);
    font-size: 0.75rem;
  }
</style>
