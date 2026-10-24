<script lang="ts">
  import {
    addRow,
    leftOf,
    MAX_ROWS,
    opsFor,
    removeRow,
    replaceRow,
    rightOf,
    rowIsMissing,
    rowOp,
    withJoin,
    withLeft,
    withOp,
    withRight,
    type RowOp,
  } from "../editor/condition";
  import { opLabel } from "../editor/labels";
  import type { Condition, NameList, Operand } from "../lib/bindings";
  import { m } from "../paraglide/messages.js";
  import OperandPicker from "./OperandPicker.svelte";

  let {
    condition,
    names,
    onchange,
  }: {
    condition: Condition | null;
    names: NameList | null;
    /**
     * The condition after an edit; `null` when the last row was removed. `typing` is true for text
     * typed into a box, which the history joins into one step; a choice is a step of its own.
     */
    onchange: (next: Condition | null, typing?: boolean) => void;
  } = $props();

  const rows = $derived(condition?.rows ?? []);
  const canAdd = $derived(
    names !== null && names.names.length > 0 && rows.length < MAX_ROWS,
  );

  function edit(
    change: (current: Condition) => Condition,
    typing = false,
  ): void {
    if (condition !== null) onchange(change(condition), typing);
  }
</script>

<div class="builder">
  {#if names !== null && names.names.length === 0}
    <p class="hint">{m.condition_no_names()}</p>
  {/if}
  {#if condition === null}
    <p class="hint">{m.condition_empty()}</p>
  {:else if rows.length > 1}
    <label class="join">
      <span>{m.condition_join()}</span>
      <select
        value={condition.join}
        onchange={(event) => {
          onchange(
            withJoin(
              condition,
              event.currentTarget.value === "Any" ? "Any" : "All",
            ),
          );
        }}
      >
        <option value="All">{m.condition_join_all()}</option>
        <option value="Any">{m.condition_join_any()}</option>
      </select>
    </label>
  {/if}

  {#each rows as row, index (index)}
    {@const number = index + 1}
    {@const op = rowOp(row)}
    {@const right = rightOf(row)}
    {@const missing = rowIsMissing(row, names)}
    <div
      class="row"
      class:missing
      role="group"
      aria-label={m.condition_row({ number })}
    >
      <OperandPicker
        operand={leftOf(row)}
        {names}
        label={m.condition_value({ number })}
        kindLabel={m.condition_kind({ number })}
        onchange={(next: Operand, typing: boolean) => {
          edit((c) => replaceRow(c, index, withLeft(row, next, names)), typing);
        }}
      />
      <select
        aria-label={m.condition_test({ number })}
        value={op}
        onchange={(event) => {
          edit((c) =>
            replaceRow(
              c,
              index,
              withOp(row, event.currentTarget.value as RowOp, names),
            ),
          );
        }}
      >
        {#each opsFor(leftOf(row), op, names) as choice (choice)}
          <option value={choice}>{opLabel(choice)}</option>
        {/each}
      </select>
      {#if right !== null}
        <OperandPicker
          operand={right}
          {names}
          label={m.condition_compare({ number })}
          kindLabel={m.condition_kind_compare({ number })}
          onchange={(next: Operand, typing: boolean) => {
            edit((c) => replaceRow(c, index, withRight(row, next)), typing);
          }}
        />
      {/if}
      <button
        type="button"
        onclick={() => {
          if (condition !== null) onchange(removeRow(condition, index));
        }}
      >
        {m.condition_remove_row({ number })}
      </button>
      {#if missing}
        <p class="problem">{m.condition_row_missing()}</p>
      {/if}
    </div>
  {/each}

  <button
    type="button"
    disabled={!canAdd}
    onclick={() => {
      onchange(addRow(condition, names));
    }}
  >
    {m.condition_add_row()}
  </button>
</div>

<style>
  .builder {
    display: grid;
    gap: 0.5rem;
  }
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 0.75rem;
  }
  .join {
    display: grid;
    gap: 0.25rem;
    color: var(--muted);
    font-size: 0.75rem;
  }
  .row {
    display: grid;
    gap: 0.375rem;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
  }
  .row.missing {
    border-color: var(--danger);
  }
  select {
    width: 100%;
    padding: 0.25rem 0.375rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: var(--surface);
    color: var(--text);
    font: inherit;
  }
  .problem {
    margin: 0;
    color: var(--danger);
    font-size: 0.75rem;
  }
</style>
