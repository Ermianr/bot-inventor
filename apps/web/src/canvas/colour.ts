import type { FieldValue } from "@bot-inventor/schema"

/**
 * The two ends of how a colour is stored and how it is shown. A Project stores
 * the integer Discord takes and the user only ever sees the swatch it stands
 * for, so the conversion lives in one place: the control that picks a colour
 * and the preview that paints one must never disagree about what a number is.
 */

/** The `#rrggbb` a colour input takes, from the integer the Project stores. */
export function colourHex(value: FieldValue): string {
  const colour = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0
  const clamped = Math.min(Math.max(colour, 0), 0xffffff)
  return `#${clamped.toString(16).padStart(6, "0")}`
}

/** The integer the Project stores, from what a colour input hands back. */
export function colourNumber(hex: string): number {
  const parsed = Number.parseInt(hex.replace("#", ""), 16)
  return Number.isNaN(parsed) ? 0 : parsed
}
