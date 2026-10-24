<script lang="ts">
  import { editor } from "../app/editor.svelte";
  import { forField, insideField } from "../editor/diagnostics";
  import { fieldLabel } from "../editor/labels";
  import { fieldPath, rowPath } from "../editor/settings";
  import type { FieldSpec } from "../lib/bindings";
  import { m } from "../paraglide/messages.js";
  import FieldControls from "./FieldControls.svelte";

  let {
    fields,
    nodeId,
    base = "",
  }: { fields: readonly FieldSpec[]; nodeId: string; base?: string } = $props();

  const marks = $derived(editor.marks);

  function text(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  function set(path: string, value: string): void {
    editor.setSetting(nodeId, path, value === "" ? undefined : value);
  }
</script>

{#each fields as field (field.name)}
  {@const path = fieldPath(base, field.name)}
  {@const value = editor.setting(nodeId, path)}
  {@const problems = forField(marks, nodeId, path)}
  {@const kind = field.kind}
  {@const id = `f-${nodeId}-${path}`}
  <div class="field" class:invalid={problems.length > 0}>
    {#if kind.type === "Boolean"}
      <label class="check">
        <input
          type="checkbox"
          checked={value === true}
          onchange={(event) => {
            const on = event.currentTarget.checked;
            editor.setSetting(
              nodeId,
              path,
              on ? true : field.required ? false : undefined,
            );
          }}
        />
        <span>{fieldLabel(field.name)}</span>
      </label>
    {:else if kind.type === "List"}
      {@const rows = Array.isArray(value) ? value : []}
      {@const inside = insideField(marks, nodeId, path)}
      <div class="list" class:invalid={inside.length > 0}>
        <span class="label">{fieldLabel(field.name)}</span>
        {#each [...rows.keys()] as index (index)}
          <fieldset>
            <legend>{m.list_row({ number: index + 1 })}</legend>
            <FieldControls
              fields={kind.value.item}
              {nodeId}
              base={rowPath(path, index)}
            />
            <button
              type="button"
              onclick={() => {
                editor.removeListRow(nodeId, path, index, field.required);
              }}
            >
              {m.list_remove()}
            </button>
          </fieldset>
        {/each}
        <button
          type="button"
          disabled={rows.length >= kind.value.max}
          onclick={() => {
            editor.addListRow(nodeId, path, kind.value);
          }}
        >
          {m.list_add()}
        </button>
      </div>
    {:else}
      <label class="label" for={id}>{fieldLabel(field.name)}</label>
      {#if kind.type === "Text" && kind.value.template}
        <textarea
          {id}
          rows="3"
          value={text(value)}
          oninput={(event) => {
            set(path, event.currentTarget.value);
          }}></textarea>
      {:else if kind.type === "Expression"}
        <textarea
          {id}
          class="code"
          rows="2"
          spellcheck="false"
          value={text(value)}
          oninput={(event) => {
            set(path, event.currentTarget.value);
          }}></textarea>
      {:else if kind.type === "Integer"}
        <input
          {id}
          type="number"
          step="1"
          min={kind.value.min}
          max={kind.value.max}
          value={typeof value === "number" ? value : ""}
          oninput={(event) => {
            const raw = event.currentTarget.value;
            if (raw === "") {
              editor.setSetting(nodeId, path, undefined);
              return;
            }
            const number = Number(raw);
            if (Number.isInteger(number))
              editor.setSetting(nodeId, path, number);
          }}
        />
      {:else if kind.type === "Choice"}
        <select
          {id}
          value={text(value)}
          onchange={(event) => {
            set(path, event.currentTarget.value);
          }}
        >
          {#if !field.required}<option value="">{m.field_none()}</option>{/if}
          {#each kind.value as word (word)}
            <option value={word}>{word}</option>
          {/each}
        </select>
      {:else}
        <input
          {id}
          type="text"
          value={text(value)}
          oninput={(event) => {
            set(path, event.currentTarget.value);
          }}
        />
      {/if}
      {#if kind.type === "Text"}
        <span class="count">
          {m.field_length({
            length: [...text(value)].length,
            max: kind.value.max,
          })}
        </span>
      {/if}
    {/if}
    {#each problems as problem, index (index)}
      <p class="problem" class:warning={problem.severity === "warning"}>
        {problem.message}
      </p>
    {/each}
  </div>
{/each}

<style>
  .field {
    position: relative;
    display: grid;
    gap: 0.25rem;
    margin-bottom: 0.75rem;
  }
  .label {
    color: var(--muted);
    font-size: 0.75rem;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  input[type="text"],
  input[type="number"],
  select,
  textarea {
    width: 100%;
    padding: 0.3125rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: var(--surface);
    color: var(--text);
    font: inherit;
  }
  textarea {
    resize: vertical;
  }
  .code {
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
  }
  .invalid > input,
  .invalid > select,
  .invalid > textarea {
    border-color: var(--danger);
  }
  .count {
    justify-self: end;
    color: var(--muted);
    font-size: 0.6875rem;
  }
  .problem {
    margin: 0;
    color: var(--danger);
    font-size: 0.75rem;
  }
  .problem.warning {
    color: var(--warning);
  }
  .list {
    display: grid;
    gap: 0.5rem;
  }
  .list.invalid {
    padding-left: 0.5rem;
    border-left: 2px solid var(--danger);
  }
  fieldset {
    margin: 0;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
  }
  legend {
    padding: 0 0.25rem;
    color: var(--muted);
    font-size: 0.75rem;
  }
</style>
