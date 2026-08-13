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
    const base = sanitise(node.id)
    let candidate = base
    let suffix = 2
    // Two Node ids can sanitise to the same text, and so can a sanitised id and
    // an already-suffixed one, so keep going until the name is actually free.
    while (taken.has(candidate)) {
      candidate = `${base}_${suffix}`
      suffix += 1
    }
    taken.add(candidate)
    prefixes.set(node.id, candidate)
  }

  return prefixes
}

function sanitise(id: string): string {
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
