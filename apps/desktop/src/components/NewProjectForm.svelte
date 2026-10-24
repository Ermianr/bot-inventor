<script lang="ts">
  import { m } from "../paraglide/messages.js";

  let {
    onsubmit,
    oncancel,
  }: { onsubmit: (name: string) => void; oncancel: () => void } = $props();

  let name = $state(m.new_project_default_name());
</script>

<form
  onsubmit={(event) => {
    event.preventDefault();
    onsubmit(name.trim());
  }}
>
  <label>
    <span>{m.new_project_name()}</span>
    <input bind:value={name} maxlength="64" required />
  </label>
  <button type="submit" class="primary" disabled={name.trim() === ""}>
    {m.new_project_choose_folder()}
  </button>
  <button type="button" onclick={oncancel}>{m.new_project_cancel()}</button>
</form>

<style>
  form {
    display: flex;
    align-items: end;
    gap: 0.5rem;
    padding: 0.625rem 1rem;
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
  }
  label {
    display: grid;
    gap: 0.125rem;
    font-size: 0.75rem;
    color: var(--muted);
  }
  input {
    min-width: 16rem;
    padding: 0.3125rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: var(--surface);
    color: var(--text);
    font: inherit;
  }
</style>
