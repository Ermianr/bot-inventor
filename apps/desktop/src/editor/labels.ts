import type { NameGroup } from "../lib/bindings";
import { m } from "../paraglide/messages.js";
import type { RowOp, ValueType } from "./condition";

const nodeLabels: Readonly<Record<string, () => string>> = {
  "discord.slash_command": m.node_discord_slash_command,
  "discord.reply": m.node_discord_reply,
  "logic.branch": m.node_logic_branch,
  "data.set_variable": m.node_data_set_variable,
};

const portLabels: Readonly<Record<string, () => string>> = {
  next: m.port_next,
  error: m.port_error,
  true: m.port_true,
  false: m.port_false,
};

const fieldLabels: Readonly<Record<string, () => string>> = {
  name: m.field_name,
  description: m.field_description,
  ephemeral: m.field_ephemeral,
  options: m.field_options,
  type: m.field_type,
  required: m.field_required,
  content: m.field_content,
  variable: m.field_variable,
  operation: m.field_operation,
  value: m.field_value,
  condition: m.field_condition,
};

const opLabels: Readonly<Record<RowOp, () => string>> = {
  eq: m.op_eq,
  ne: m.op_ne,
  lt: m.op_lt,
  le: m.op_le,
  gt: m.op_gt,
  ge: m.op_ge,
  contains: m.op_contains,
  not_contains: m.op_not_contains,
  starts_with: m.op_starts_with,
  not_starts_with: m.op_not_starts_with,
  ends_with: m.op_ends_with,
  not_ends_with: m.op_not_ends_with,
  includes: m.op_includes,
  not_includes: m.op_not_includes,
  set: m.op_set,
  not_set: m.op_not_set,
};

const groupLabels: Readonly<Record<NameGroup, () => string>> = {
  Event: m.group_event,
  Step: m.group_step,
  Variable: m.group_variable,
  Error: m.group_error,
};

const valueLabels: Readonly<Record<ValueType, () => string>> = {
  text: m.value_text,
  integer: m.value_integer,
  decimal: m.value_decimal,
  boolean: m.value_boolean,
};

/** The words of a test of the condition builder. */
export function opLabel(op: RowOp): string {
  return opLabels[op]();
}

/** The title of a group of names in a menu. */
export function groupLabel(group: NameGroup): string {
  return groupLabels[group]();
}

/** The name of a kind of typed value. */
export function valueLabel(type: ValueType): string {
  return valueLabels[type]();
}

/** The name of a node type for the person using the editor; a type with no text shows its id. */
export function nodeLabel(typeId: string): string {
  return nodeLabels[typeId]?.() ?? typeId;
}

/** The name of an output port; a port with no text shows its own name. */
export function portLabel(port: string): string {
  return portLabels[port]?.() ?? port;
}

/** The label of a field of a node; a field with no text shows its own name. */
export function fieldLabel(name: string): string {
  return fieldLabels[name]?.() ?? name;
}
