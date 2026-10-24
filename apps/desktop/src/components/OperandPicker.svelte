<script lang="ts">
  import {
    emptyValue,
    findName,
    groupedNames,
    isMissing,
    valueType,
    type ValueType,
  } from "../editor/condition";
  import { groupLabel, valueLabel } from "../editor/labels";
  import type { NameInfo, NameList, Operand } from "../lib/bindings";
  import { m } from "../paraglide/messages.js";

  let {
    operand,
    names,
    label,
    kindLabel,
    onlyNames = false,
    onchange,
  }: {
    operand: Operand;
    names: NameList | null;
    /** The accessible name of the menu. */
    label: string;
    /** The accessible name of the menu of the kind of value. */
    kindLabel: string;
    /** A side that can only be a name, as the one of a presence test. */
    onlyNames?: boolean;
    /** `typing` is true for text typed into a box, which the history joins into one step. */
    onchange: (next: Operand, typing: boolean) => void;
  } = $props();

  const NAME = "name:";
  const MISSING = "missing";
  const groups = $derived(groupedNames(names));
  const missing = $derived(isMissing(operand, names));
  const types: readonly ValueType[] = ["text", "integer", "decimal", "boolean"];

  const choice = $derived(
    operand.type === "Name"
      ? missing || findName(names, operand.value) === undefined
        ? MISSING
        : NAME + operand.value.join("\u0001")
      : (valueType(operand) ?? "text"),
  );

  function describe(name: NameInfo): string {
    if (name.availability === "Sometimes") {
      return m.condition_sometimes({ name: name.source });
    }
    return name.optional
      ? m.condition_optional({ name: name.source })
      : name.source;
  }

  function pick(value: string): void {
    if (value === MISSING) return;
    if (value.startsWith(NAME)) {
      const key = value.slice(NAME.length);
      const found = names?.names.find((n) => n.segments.join("\u0001") === key);
      if (found !== undefined) {
        onchange({ type: "Name", value: [...found.segments] }, false);
      }
      return;
    }
    onchange(emptyValue(value as ValueType), false);
  }

  function number(raw: string, whole: boolean): number | null {
    if (raw.trim() === "") return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    return whole ? (Number.isInteger(parsed) ? parsed : null) : parsed;
  }
</script>

<span class="operand" class:missing={choice === MISSING}>
  <select
    aria-label={label}
    value={choice}
    onchange={(event) => {
      pick(event.currentTarget.value);
    }}
  >
    {#if operand.type === "Name" && choice === MISSING}
      <option value={MISSING}>
        {m.condition_missing({ name: operand.value.join(".") })}
      </option>
    {/if}
    {#each groups as group (group.group)}
      <optgroup label={groupLabel(group.group)}>
        {#each group.names as name (name.source)}
          <option value={NAME + name.segments.join("\u0001")}>
            {describe(name)}
          </option>
        {/each}
      </optgroup>
    {/each}
    {#if !onlyNames}
      <optgroup label={m.value_group()}>
        {#each types as type (type)}
          <option value={type}>{valueLabel(type)}</option>
        {/each}
      </optgroup>
    {/if}
  </select>
  {#if operand.type === "Text"}
    <input
      type="text"
      aria-label={kindLabel}
      value={operand.value}
      oninput={(event) => {
        onchange({ type: "Text", value: event.currentTarget.value }, true);
      }}
    />
  {:else if operand.type === "Integer"}
    <input
      type="number"
      step="1"
      aria-label={kindLabel}
      value={operand.value}
      oninput={(event) => {
        const parsed = number(event.currentTarget.value, true);
        if (parsed !== null) onchange({ type: "Integer", value: parsed }, true);
      }}
    />
  {:else if operand.type === "Decimal"}
    <input
      type="number"
      step="any"
      aria-label={kindLabel}
      value={operand.value ?? 0}
      oninput={(event) => {
        const parsed = number(event.currentTarget.value, false);
        if (parsed !== null) onchange({ type: "Decimal", value: parsed }, true);
      }}
    />
  {:else if operand.type === "Boolean"}
    <select
      aria-label={kindLabel}
      value={operand.value ? "true" : "false"}
      onchange={(event) => {
        onchange(
          { type: "Boolean", value: event.currentTarget.value === "true" },
          false,
        );
      }}
    >
      <option value="true">{m.value_true()}</option>
      <option value="false">{m.value_false()}</option>
    </select>
  {/if}
</span>

<style>
  .operand {
    display: grid;
    gap: 0.25rem;
  }
  select,
  input {
    width: 100%;
    padding: 0.25rem 0.375rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: var(--surface);
    color: var(--text);
    font: inherit;
  }
  .missing select {
    border-color: var(--danger);
    color: var(--danger);
  }
</style>
