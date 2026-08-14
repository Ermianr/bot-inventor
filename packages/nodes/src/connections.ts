import { type CoercionDefinition, findCoercion } from "./coercions.js"
import type { PortDefinition } from "./definition.js"

/**
 * Whether a Wire may be drawn between two Ports, and what it costs. The editor
 * asks this while the user is still dragging, so it answers from the Port
 * declarations and the Coercion table alone — no Project, no Compiler.
 */
export type ConnectionCheck =
  | {
      legal: true
      /** The Coercion the Wire applies, or `undefined` when the types already match. */
      coercion: CoercionDefinition | undefined
    }
  | {
      legal: false
      /** Why the editor refused it, as a key for the i18n layer. */
      reasonKey: string
    }

/**
 * Answers "is this connection legal, and does it coerce?" for a Wire from
 * `from` to `to`. The same table the Compiler emits from decides it, which is
 * why a Wire the editor accepted always compiles.
 */
export function checkConnection(from: PortDefinition, to: PortDefinition): ConnectionCheck {
  if (from.direction !== "output" || to.direction !== "input") {
    return { legal: false, reasonKey: "connections.rejected.direction" }
  }

  if (from.kind !== to.kind) {
    return { legal: false, reasonKey: "connections.rejected.kind" }
  }

  // An Execution Wire carries no value, so there is nothing left to check.
  if (from.kind === "execution" || to.kind === "execution") {
    return { legal: true, coercion: undefined }
  }

  if (from.dataType === to.dataType) return { legal: true, coercion: undefined }

  const coercion = findCoercion(from.dataType, to.dataType)
  if (coercion === undefined) {
    return { legal: false, reasonKey: "connections.rejected.dataType" }
  }
  return { legal: true, coercion }
}
