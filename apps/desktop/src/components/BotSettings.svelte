<script lang="ts">
  import { onMount } from "svelte";
  import { run } from "../app/run.svelte";
  import { m } from "../paraglide/messages.js";

  let { onclose }: { onclose: () => void } = $props();

  let dialog = $state<HTMLDialogElement>();
  // The token is read from the field when it is sent and never held in state.
  let tokenInput = $state<HTMLInputElement>();
  let hasToken = $state(false);
  let guild = $state(run.settings?.dev_guild ?? "");
  let tokenMessage = $state<{ ok: boolean; text: string } | null>(null);
  let guildMessage = $state<{ ok: boolean; text: string } | null>(null);
  let busy = $state(false);

  onMount(() => {
    dialog?.showModal();
    run.loadSettings();
  });

  async function saveToken(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (tokenInput === undefined || busy) return;
    const token = tokenInput.value;
    // Empty at once, whatever the answer: the field never keeps a token.
    tokenInput.value = "";
    hasToken = false;
    if (token === "") return;
    busy = true;
    const reply = await run.saveToken(token);
    busy = false;
    tokenMessage = reply.ok
      ? { ok: true, text: m.token_saved() }
      : { ok: false, text: reply.message };
  }

  async function saveGuild(value: string | null): Promise<void> {
    busy = true;
    const reply = await run.saveDevGuild(value);
    busy = false;
    if (reply.ok) {
      if (value === null) guild = "";
      guildMessage = {
        ok: true,
        text: value === null ? m.dev_removed() : m.dev_saved(),
      };
    } else {
      guildMessage = { ok: false, text: reply.message };
    }
  }
</script>

<dialog bind:this={dialog} aria-labelledby="settings-title" {onclose}>
  <h2 id="settings-title">{m.settings_title()}</h2>

  <form onsubmit={saveToken}>
    <label for="bot-token">{m.token_label()}</label>
    <div class="line">
      <input
        id="bot-token"
        type="password"
        autocomplete="off"
        spellcheck="false"
        autocapitalize="off"
        bind:this={tokenInput}
        oninput={() => {
          hasToken = (tokenInput?.value ?? "") !== "";
        }}
      />
      <button type="submit" class="primary" disabled={busy || !hasToken}>
        {m.token_save()}
      </button>
    </div>
    <p class="state" role="status">
      {run.settings?.token_set ? m.token_set() : m.token_unset()}
    </p>
    {#if tokenMessage !== null}
      <p class="message" class:bad={!tokenMessage.ok} role="alert">
        {tokenMessage.text}
      </p>
    {/if}
    <p class="help">{m.token_help()}</p>
  </form>

  <form
    onsubmit={(event) => {
      event.preventDefault();
      void saveGuild(guild.trim() === "" ? null : guild.trim());
    }}
  >
    <label for="dev-guild">{m.dev_label()}</label>
    <div class="line">
      <input
        id="dev-guild"
        inputmode="numeric"
        autocomplete="off"
        maxlength="20"
        bind:value={guild}
      />
      <button type="submit" disabled={busy || guild.trim() === ""}>
        {m.dev_save()}
      </button>
      <button
        type="button"
        disabled={busy || run.settings?.dev_guild == null}
        onclick={() => {
          void saveGuild(null);
        }}
      >
        {m.dev_remove()}
      </button>
    </div>
    {#if guildMessage !== null}
      <p class="message" class:bad={!guildMessage.ok} role="alert">
        {guildMessage.text}
      </p>
    {/if}
    <p class="help">{m.dev_help()}</p>
  </form>

  <div class="actions">
    <button
      type="button"
      onclick={() => {
        dialog?.close();
      }}
    >
      {m.settings_close()}
    </button>
  </div>
</dialog>

<style>
  dialog {
    width: min(32rem, calc(100vw - 2rem));
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
    margin-bottom: 1rem;
  }
  label {
    font-size: 0.75rem;
    color: var(--muted);
  }
  .line {
    display: flex;
    gap: 0.5rem;
  }
  input {
    flex: 1;
    min-width: 0;
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
  .state {
    font-weight: 600;
  }
  .message {
    color: var(--muted);
  }
  .message.bad {
    color: var(--danger);
  }
  .help {
    color: var(--muted);
    font-size: 0.75rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
