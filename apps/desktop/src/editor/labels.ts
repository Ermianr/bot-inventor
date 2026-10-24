import { m } from "../paraglide/messages.js";

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
