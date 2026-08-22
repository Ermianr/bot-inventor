import type { core, ZodMiniType } from "zod/mini"

/**
 * A Validator, as `CONTEXT.md` defines it: a thing that takes an unknown value
 * and either accepts it as a `T` or reports why it cannot.
 *
 * It exists so that annotations this package has to write — the recursive
 * field-value schema breaking its own recursion, above all — say our name for
 * the concept rather than the validation library's.
 */
export type Validator<T> = ZodMiniType<T>

/** One reason a {@link Validator} refused a value. */
export type ValidationIssue = core.$ZodIssue
