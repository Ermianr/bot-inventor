import type { FieldValue } from "@bot-inventor/schema"

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
export type DataType = "text" | "user"

export type PortDirection = "input" | "output"

/** An Execution Port: it defines the order things happen in, and carries no value. */
export type ExecutionPortDefinition = {
  id: string
  kind: "execution"
  direction: PortDirection
  labelKey: string
}

/** A Data Port: it carries a value of one type. */
export type DataPortDefinition = {
  id: string
  kind: "data"
  direction: PortDirection
  dataType: DataType
  labelKey: string
}

export type PortDefinition = ExecutionPortDefinition | DataPortDefinition

/**
 * How a field is edited on the Canvas. `commandParameters` is the list of
 * values a slash command asks its caller for, edited as a list rather than as
 * one control.
 */
export type FieldControl = "text" | "number" | "switch" | "commandParameters"

/** A value typed directly into the Node on the Canvas. */
export type FieldDefinition = {
  id: string
  labelKey: string
  control: FieldControl
  defaultValue: FieldValue
}

/**
 * A Tracing statement a Node asks for. It emits nothing in Build mode, so a
 * Node author writes the same generate() for both modes.
 */
export type TraceRequest =
  | { kind: "node-entered" }
  | { kind: "value-produced"; port: string; expression: string }

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
  /** The identifier this Node must bind a Data output Port's value to. */
  output(id: string): string
  /** The statements of everything reachable from an Execution output Port. */
  continuation(portId: string): string
  /** Renders a value as a JavaScript literal. */
  literal(value: unknown): string
  /** A Tracing statement, or the empty string in Build mode. */
  trace(request: TraceRequest): string
}

export type NodeDefinition = {
  /** Stable and English. Renaming it breaks saved Projects. */
  id: string
  labelKey: string
  descriptionKey: string
  /** A Trigger has no Execution input and starts a run. */
  isTrigger: boolean
  ports: readonly PortDefinition[]
  fields: readonly FieldDefinition[]
  /** Emits this Node's JavaScript, including the continuation of its Execution outputs. */
  generate(context: GenerationContext): string
}

export function findPort(definition: NodeDefinition, id: string): PortDefinition | undefined {
  return definition.ports.find(port => port.id === id)
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
