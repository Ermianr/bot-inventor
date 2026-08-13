import type { DataType } from "./definition.js"

/**
 * A predefined automatic conversion between two Port types, applied when a Wire
 * is connected instead of the connection being rejected. The editor draws it on
 * the Wire; the Compiler emits the call named here. A pair of types missing
 * from this table is a connection the editor refuses.
 */
export type CoercionDefinition = {
  from: DataType
  to: DataType
  /** The Coercions method the generated code calls, on the Runtime. */
  runtimeCall: string
  /** What the editor writes on the Wire. */
  labelKey: string
}

export const coercions: readonly CoercionDefinition[] = [
  {
    from: "user",
    to: "string",
    runtimeCall: "userToText",
    labelKey: "coercions.userToText.label"
  },
  {
    from: "number",
    to: "string",
    runtimeCall: "numberToText",
    labelKey: "coercions.numberToText.label"
  },
  {
    from: "boolean",
    to: "string",
    runtimeCall: "booleanToText",
    labelKey: "coercions.booleanToText.label"
  }
]

/** The Coercion a Wire from `from` to `to` needs, or `undefined` when none exists. */
export function findCoercion(from: DataType, to: DataType): CoercionDefinition | undefined {
  return coercions.find(coercion => coercion.from === from && coercion.to === to)
}

/** Wraps an expression in the Runtime call that performs a Coercion. */
export function applyCoercion(
  expression: string,
  coercion: CoercionDefinition,
  runtime: string
): string {
  return `${runtime}.coerce.${coercion.runtimeCall}(${expression})`
}
