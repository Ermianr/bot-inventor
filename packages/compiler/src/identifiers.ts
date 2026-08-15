import type { Node } from "@bot-inventor/schema"

/**
 * Node ids come from the editor and may contain anything; the identifiers they
 * become in the generated code may not. Names are assigned once per Flow so
 * that two Node ids which sanitise to the same text still get distinct ones.
 */
export function assignIdentifierPrefixes(nodes: readonly Node[]): ReadonlyMap<string, string> {
  const taken = new Set<string>()
  const prefixes = new Map<string, string>()

  for (const node of nodes) {
    prefixes.set(node.id, claimIdentifier(taken, sanitise(node.id)))
  }

  return prefixes
}

/**
 * A free identifier built from `base`, recorded in `taken` so nothing else can
 * claim it. Two different ids can sanitise to the same text, and so can a
 * sanitised id and an already-suffixed one, so it keeps going until the name is
 * actually free.
 */
export function claimIdentifier(taken: Set<string>, base: string): string {
  let candidate = base
  let suffix = 2
  while (taken.has(candidate)) {
    candidate = `${base}_${suffix}`
    suffix += 1
  }
  taken.add(candidate)
  return candidate
}

/**
 * Text made safe to use as part of a JavaScript identifier. Port ids reach here
 * as well as Node ids: a slash command parameter's Port is named after what the
 * user typed, which is not an identifier.
 */
export function sanitise(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_$]/g, "_")
  return /^[A-Za-z_$]/.test(cleaned) ? cleaned : `_${cleaned}`
}

/** Renders a value as the JavaScript literal that reproduces it. */
export function literal(value: unknown): string {
  const rendered = JSON.stringify(value)
  if (rendered === undefined) {
    throw new Error(`the value ${String(value)} cannot be written into generated code`)
  }
  return rendered
}
