/**
 * A Project that cannot be turned into JavaScript. The message names the Flow,
 * the Node and the Port at fault, because it is what the editor turns into
 * something the user can act on.
 */
export class CompilerError extends Error {
  readonly flow: string
  readonly node: string | undefined

  constructor(message: string, context: { flow: string; node?: string }) {
    super(message)
    this.name = "CompilerError"
    this.flow = context.flow
    this.node = context.node
  }
}
