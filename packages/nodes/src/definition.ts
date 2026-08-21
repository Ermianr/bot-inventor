import type { FieldValue, Node } from "@bot-inventor/schema"

import { slotPorts } from "./slots.js"

/**
 * The interface every Node of the catalogue implements. A Node's visual
 * declaration and its code generation are the same object, on purpose: adding
 * Nodes is this product's permanent activity, and splitting the two would tax
 * every single one of them (ADR 0001).
 */

/** Which mode the Compiler is emitting for. It is a parameter, never a second code path. */
export type CompilerMode = "development" | "build"

/**
 * The type a Data Port carries. Coercions are defined between these, and a
 * Wire between two of them is legal only when they match or the Coercion table
 * has an entry for the pair.
 */
export type DataType = "text" | "number" | "boolean" | "user" | "embed"

export type PortDirection = "input" | "output"

/**
 * What every Port carries, whichever kind it is.
 *
 * A Port is normally named through the i18n layer, but a Port that exists
 * because the user declared it — a slash command parameter — is named by them,
 * in whatever language they typed. `label` is that text, and it wins over
 * `labelKey` when it is there, because there is nothing to translate.
 */
type PortIdentity = {
  id: string
  direction: PortDirection
  labelKey: string
  label?: string
}

/** An Execution Port: it defines the order things happen in, and carries no value. */
export type ExecutionPortDefinition = PortIdentity & {
  kind: "execution"
}

/** A Data Port: it carries a value of one type. */
export type DataPortDefinition = PortIdentity & {
  kind: "data"
  dataType: DataType
}

export type PortDefinition = ExecutionPortDefinition | DataPortDefinition

/**
 * How a field is edited on the Canvas. `slottedText` is text a Slot can be put
 * inside of, so its value is a sequence rather than a string (ADR 0010), and
 * `slottedParagraph` is the same value written over several lines — an Embed's
 * description is one, a Node's title is not.
 * `commandParameters` is the list of values a slash command asks its caller
 * for, and `embedFields` the name-and-value pairs inside an Embed: both are
 * edited as a list rather than as one control. `colour` is a colour the
 * user picks and the Project stores as the integer Discord takes: the number
 * is never shown to them.
 */
export type FieldControl =
  | "text"
  | "slottedText"
  | "slottedParagraph"
  | "number"
  | "switch"
  | "commandParameters"
  | "embedFields"
  | "colour"

/** The values typed into one Node's fields, as the Project stores them. */
export type NodeFields = Node["fields"]

/** A value typed directly into the Node on the Canvas. */
export type FieldDefinition = {
  id: string
  labelKey: string
  control: FieldControl
  defaultValue: FieldValue
  /**
   * How many characters the field takes, when something outside this editor
   * refuses a longer one. The editor stops the typing there and shows the
   * count, so the user meets the limit while they are writing rather than when
   * the bot runs.
   */
  limit?: number
}

/**
 * Something wrong with what is typed into a Node, drawn on the Node itself and
 * refused again before a Run starts.
 *
 * It names a message rather than carrying a sentence, because the editor says
 * it in the user's own language; what the sentence needs is in `values`.
 */
export type NodeProblem = {
  messageKey: string
  values?: Record<string, string>
}

/**
 * A Tracing statement a Node asks for. It emits nothing in Build mode, so a
 * Node author writes the same generate() for both modes.
 *
 * Only the two moments a Node knows about are asked for here. What a Wire
 * carried is the Compiler's to report, because the Wire is the Compiler's to
 * find, and a Node reporting its own outputs would say nothing about the ones
 * nobody connected.
 */
export type TraceRequest = { kind: "node-entered" } | { kind: "node-completed" }

/**
 * What a Node's generate() is given. Everything graph-shaped — where a Data
 * input comes from, what runs next — is answered here, so a Node never walks
 * the Project itself.
 */
export type GenerationContext = {
  mode: CompilerMode
  /** The identifier holding the Runtime in the generated code. */
  runtime: string
  /** The identifier holding the Discord event of the current run. */
  event: string
  /** The value typed into one of this Node's fields, or the field's default. */
  field(id: string): FieldValue
  /**
   * A JavaScript expression for a Data input Port: the wired source put through
   * any Coercion the Wire needs, or this Node's inline field of the same id
   * when nothing is wired.
   */
  input(id: string): string
  /**
   * Whether a Data input Port has a Wire arriving at it.
   *
   * A Node asks when the answer changes what it emits rather than only which
   * expression it reads — Reply sends an Embed when one is wired and a line of
   * text when none is — because a Data input Port with no field behind it has
   * nothing to fall back on.
   */
  isWired(id: string): boolean
  /**
   * A JavaScript expression for a Slotted text field: its segments joined in
   * order, each Slot read from the Wire drawn to its Port and put through
   * whatever Coercion that Wire needs. A Slot nothing is wired to reads as
   * empty text (ADR 0010).
   */
  slottedField(id: string): string
  /**
   * The same for a piece of Slotted text a Node holds somewhere other than in a
   * field of its own — the name and the value of an Embed Field, which live
   * inside the list their field holds. `where` names it in the words the user
   * would recognise, for the refusal a value that does not read as text earns.
   */
  slottedText(value: FieldValue, where: string): string
  /** The identifier this Node must bind a Data output Port's value to. */
  output(id: string): string
  /** The statements of everything reachable from an Execution output Port. */
  continuation(portId: string): string
  /** Renders a value as a JavaScript literal. */
  literal(value: unknown): string
  /**
   * A Tracing statement, or the empty string in Build mode. A Node emits
   * `node-entered` before it does anything and `node-completed` once it has,
   * which is what the Canvas lights up as the run travels through it.
   */
  trace(request: TraceRequest): string
}

/**
 * How a Node is drawn on the Canvas when there is too much typed into it to
 * draw there: a bar in the colour one of its fields holds, and the one line of
 * text that says which of several Nodes of the same type this one is.
 *
 * It names fields rather than carrying values, because what it draws is what
 * the user typed a moment ago, and the Canvas reads it off the Node it is
 * already holding.
 */
export type NodeSummary = {
  /** The field holding the colour of the bar, when the Node has such a field. */
  colourField?: string
  /** The Slotted field whose text is drawn beside the bar. */
  titleField: string
}

/** What a Node builds, when the editor can draw it before the bot runs. */
export type PreviewKind = "embed"

export type NodeDefinition = {
  /** Stable and English. Renaming it breaks saved Projects. */
  id: string
  labelKey: string
  descriptionKey: string
  /** A Trigger has no Execution input and starts a run. */
  isTrigger: boolean
  /** The Ports every Node of this type has, whatever is typed into it. */
  ports: readonly PortDefinition[]
  fields: readonly FieldDefinition[]
  /**
   * How the Node is drawn when it is not the Node its fields are typed into.
   *
   * A Node that declares a summary is edited in the Inspector beside the
   * Canvas: an Embed holds thirteen fields and a list of pairs, and a Canvas of
   * Nodes that big is a Canvas nobody can see the Flow in.
   */
  summary?: NodeSummary
  /**
   * What this Node builds, when the Inspector can draw it as the user will see
   * it. A preview is the honest answer to "what will this message look like",
   * and it is declared here so that the Inspector never asks which Node it is
   * looking at.
   */
  preview?: PreviewKind
  /**
   * The Ports this Node has because of what the user typed into it — one per
   * slash command parameter, and one per whatever the Nodes after it declare.
   *
   * It is a function of the fields alone so that the editor, the Compiler and
   * the connection rules all arrive at the same list, and so that a Port
   * disappearing is nothing more than a field being edited.
   */
  dynamicPorts?(fields: NodeFields): readonly PortDefinition[]
  /**
   * What is wrong with what the user typed, if anything. The editor draws it on
   * the Node and refuses to start the Run while it is not empty, so a mistake
   * the editor already knows about is never something the user debugs on a live
   * bot.
   */
  problems?(fields: NodeFields): readonly NodeProblem[]
  /** Emits this Node's JavaScript, including the continuation of its Execution outputs. */
  generate(context: GenerationContext): string
}

/**
 * Every Port a Node instance has: the fixed ones its type always carries, then
 * the ones its own fields declare.
 *
 * The Slots typed into its text fields are among those: a Slot is a Port like
 * any other, and deriving it here rather than in each Node's `dynamicPorts`
 * means a Node that gains a Slotted field gains nothing else to write.
 */
export function portsOf(definition: NodeDefinition, fields: NodeFields): readonly PortDefinition[] {
  const dynamic = [
    ...slotPorts(definition.fields, fields),
    ...(definition.dynamicPorts?.(fields) ?? [])
  ]
  return dynamic.length === 0 ? definition.ports : [...definition.ports, ...dynamic]
}

/**
 * One of a Node instance's Ports. The fields are what decide whether a dynamic
 * Port is there at all, so a caller holding a Node instance must pass them:
 * omitting them answers about the Node's type, not about the Node.
 */
export function findPort(
  definition: NodeDefinition,
  id: string,
  fields: NodeFields = {}
): PortDefinition | undefined {
  return portsOf(definition, fields).find(port => port.id === id)
}

export function findField(definition: NodeDefinition, id: string): FieldDefinition | undefined {
  return definition.fields.find(field => field.id === id)
}

/**
 * The value a Node's field starts at. It is a fresh copy every time: a
 * definition lives for the life of the process, so handing out its own list
 * would let one Node's edits appear on every other Node that never set the
 * field.
 */
export function defaultFieldValue(field: FieldDefinition): FieldValue {
  return structuredClone(field.defaultValue)
}

/**
 * Joins generated statements, dropping the empty strings that Tracing hooks and
 * unwired Execution Ports leave behind.
 */
export function joinStatements(lines: readonly string[]): string {
  return lines.filter(line => line.length > 0).join("\n")
}

/** Indents a block of generated code, leaving blank lines blank. */
export function indent(code: string, level = 1): string {
  const padding = "  ".repeat(level)
  return code
    .split("\n")
    .map(line => (line.length === 0 ? line : padding + line))
    .join("\n")
}
