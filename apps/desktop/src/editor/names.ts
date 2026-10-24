/**
 * Names the editor makes up: node ids, aliases and flow names. Rust checks them again when the
 * project is saved (`graph::names`); these rules only let the editor avoid a name Rust would
 * refuse.
 */

const FLOW_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ALIAS = /^[a-z_][a-z0-9_]{0,63}$/;
const MAX_NAME_LENGTH = 64;
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 10;

/** A number in `[0, 1)`; tests pass a fixed sequence. */
export type Random = () => number;

export const secureRandom: Random = () => {
  const [value] = crypto.getRandomValues(new Uint32Array(1));
  return (value ?? 0) / 2 ** 32;
};

/** Whether `name` is a valid flow name: 1 to 64 lowercase letters, digits, `_` or `-`. */
export function isFlowName(name: string): boolean {
  return FLOW_NAME.test(name);
}

/** Whether `name` is a valid alias: 1 to 64 lowercase letters, digits or `_`, not starting with a digit. */
export function isAlias(name: string): boolean {
  return ALIAS.test(name);
}

/** An opaque node id that is not in `taken`. */
export function newNodeId(
  taken: ReadonlySet<string>,
  random: Random = secureRandom,
): string {
  for (;;) {
    let id = "n";
    for (let i = 0; i < ID_LENGTH; i++) {
      id += ID_ALPHABET.charAt(Math.floor(random() * ID_ALPHABET.length));
    }
    if (!taken.has(id)) return id;
  }
}

/** The alias for a new node of `typeId`: `reply`, then `reply_2`, `reply_3`, and so on. */
export function newAlias(typeId: string, taken: ReadonlySet<string>): string {
  const last = typeId.slice(typeId.lastIndexOf(".") + 1).toLowerCase();
  let base = last.replace(/[^a-z0-9_]/g, "_");
  if (base === "" || /^[0-9]/.test(base)) base = `n_${base}`;
  return firstFree(base, taken);
}

/** The name for a new flow: `flow`, then `flow_2`, and so on. */
export function newFlowName(taken: ReadonlySet<string>): string {
  return firstFree("flow", taken);
}

function firstFree(base: string, taken: ReadonlySet<string>): string {
  const start = base.slice(0, MAX_NAME_LENGTH);
  if (!taken.has(start)) return start;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const candidate = base.slice(0, MAX_NAME_LENGTH - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}
