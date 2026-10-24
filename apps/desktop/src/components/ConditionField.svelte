<script lang="ts">
  import { editor } from "../app/editor.svelte";
  import type { Condition } from "../lib/bindings";
  import { m } from "../paraglide/messages.js";
  import ConditionBuilder from "./ConditionBuilder.svelte";
  import ExpressionEditor from "./ExpressionEditor.svelte";

  let {
    nodeId,
    path,
    source,
    label,
    invalid = false,
  }: {
    nodeId: string;
    path: string;
    /** The expression as the project holds it; empty when the field is not set. */
    source: string;
    label: string;
    invalid?: boolean;
  } = $props();

  let mode = $state<"builder" | "advanced">("builder");
  let condition = $state.raw<Condition | null>(null);
  let message = $state<string | null>(null);

  // The text this field has shown or written last. A text that differs came from outside (an
  // undo, a redo): the builder reads it again.
  let known: string | null = null;
  let first = true;
  let sequence = 0;

  const names = $derived(editor.namesOf(nodeId));

  $effect(() => {
    const text = source;
    if (text === known) return;
    void load(text);
  });

  async function load(text: string): Promise<void> {
    known = text;
    const mine = ++sequence;
    if (text.trim() === "") {
      condition = null;
      first = false;
      return;
    }
    const reply = await editor.readCondition(text);
    if (mine !== sequence) return;
    const readable = reply.ok && reply.value !== null;
    condition = readable ? reply.value : null;
    if (!readable && (first || mode === "builder")) {
      mode = "advanced";
      message = first ? null : m.condition_not_readable();
    } else if (readable) {
      message = null;
    }
    first = false;
  }

  async function change(next: Condition | null, typing = false): Promise<void> {
    condition = next;
    message = null;
    const mine = ++sequence;
    if (next === null) {
      known = "";
      editor.setSetting(nodeId, path, undefined, false);
      return;
    }
    const reply = await editor.writeCondition(next);
    if (mine !== sequence) return;
    if (!reply.ok) {
      message = m.condition_cannot_write({ reason: reply.message });
      return;
    }
    known = reply.value;
    editor.setSetting(nodeId, path, reply.value, typing);
  }

  function type(text: string): void {
    known = text;
    sequence += 1;
    editor.setSetting(nodeId, path, text === "" ? undefined : text);
  }

  async function toBuilder(): Promise<void> {
    if (source.trim() === "") {
      condition = null;
      message = null;
      mode = "builder";
      return;
    }
    const reply = await editor.readCondition(source);
    if (reply.ok && reply.value !== null) {
      condition = reply.value;
      message = null;
      mode = "builder";
    } else {
      message = reply.ok ? m.condition_not_readable() : reply.message;
    }
  }
</script>

<div class="condition">
  <div class="modes" role="group" aria-label={m.condition_modes()}>
    <button
      type="button"
      aria-pressed={mode === "builder"}
      onclick={() => {
        void toBuilder();
      }}
    >
      {m.condition_mode_builder()}
    </button>
    <button
      type="button"
      aria-pressed={mode === "advanced"}
      onclick={() => {
        mode = "advanced";
        message = null;
      }}
    >
      {m.condition_mode_advanced()}
    </button>
  </div>

  {#if message !== null}
    <p class="note">{message}</p>
  {/if}

  {#if mode === "builder"}
    <ConditionBuilder
      {condition}
      {names}
      onchange={(next: Condition | null, typing?: boolean) => {
        void change(next, typing);
      }}
    />
    <div class="expression">
      <span class="caption">{m.condition_expression()}</span>
      <code aria-label={m.condition_expression()}>{source}</code>
    </div>
  {:else}
    <ExpressionEditor
      value={source}
      {label}
      names={names?.names ?? []}
      {invalid}
      onchange={type}
    />
  {/if}
</div>

<style>
  .condition {
    display: grid;
    gap: 0.5rem;
  }
  .modes {
    display: flex;
    gap: 0.25rem;
  }
  .modes button[aria-pressed="true"] {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .note {
    margin: 0;
    color: var(--warning);
    font-size: 0.75rem;
  }
  .expression {
    display: grid;
    gap: 0.125rem;
  }
  .caption {
    color: var(--muted);
    font-size: 0.6875rem;
  }
  code {
    padding: 0.25rem 0.5rem;
    overflow-wrap: anywhere;
    border-radius: 0.375rem;
    background: var(--surface-2);
    font-size: 0.8125rem;
  }
</style>
