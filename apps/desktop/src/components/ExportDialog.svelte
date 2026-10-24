<script lang="ts">
  import { onMount } from "svelte";
  import { editor } from "../app/editor.svelte";
  import { run } from "../app/run.svelte";
  import { defaultBotName } from "../editor/logs";
  import { m } from "../paraglide/messages.js";

  let { onclose }: { onclose: () => void } = $props();

  let dialog = $state<HTMLDialogElement>();
  let name = $state(defaultBotName(editor.project?.manifest.name ?? ""));
  let problem = $state<string | null>(null);

  onMount(() => {
    dialog?.showModal();
  });

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    problem = null;
    const result = await run.exportBot(name.trim());
    if (result.kind === "failed") {
      problem = result.message;
    } else if (result.kind !== "cancelled") {
      dialog?.close();
    }
  }
</script>

<dialog bind:this={dialog} aria-labelledby="export-title" {onclose}>
  <h2 id="export-title">{m.export_title()}</h2>
  <form onsubmit={submit}>
    <label for="bot-name">{m.export_name()}</label>
    <input
      id="bot-name"
      bind:value={name}
      maxlength="64"
      autocomplete="off"
      spellcheck="false"
      aria-invalid={problem !== null}
      aria-describedby={problem === null ? undefined : "bot-name-problem"}
    />
    {#if problem !== null}
      <p id="bot-name-problem" class="problem" role="alert">{problem}</p>
    {/if}
    <p class="help">{m.export_help()}</p>
    <div class="actions">
      <button
        type="button"
        onclick={() => {
          dialog?.close();
        }}
      >
        {m.export_cancel()}
      </button>
      <button
        type="submit"
        class="primary"
        disabled={run.exporting || name.trim() === ""}
      >
        {run.exporting ? m.export_working() : m.export_submit()}
      </button>
    </div>
  </form>
</dialog>

<style>
  dialog {
    width: min(28rem, calc(100vw - 2rem));
    padding: 1rem 1.25rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 8px 32px var(--shadow);
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 40%);
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
  }
  form {
    display: grid;
    gap: 0.25rem;
  }
  label {
    font-size: 0.75rem;
    color: var(--muted);
  }
  input {
    padding: 0.3125rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: var(--surface);
    color: var(--text);
    font: inherit;
  }
  p {
    margin: 0;
  }
  .problem {
    color: var(--danger);
  }
  .help {
    color: var(--muted);
    font-size: 0.75rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
</style>
