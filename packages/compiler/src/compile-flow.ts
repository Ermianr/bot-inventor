import {
  applyCoercion,
  type CompilerMode,
  type DataType,
  danglingEndsOf,
  defaultFieldValue,
  findCoercion,
  findDanglingWires,
  findField,
  findPort,
  type GenerationContext,
  indent,
  joinStatements,
  type NodeCatalogue,
  type NodeDefinition,
  type TraceRequest
} from "@bot-inventor/nodes"
import type { FieldValue, Flow, Node } from "@bot-inventor/schema"
import { CompilerError } from "./errors.js"
import { assignIdentifierPrefixes, claimIdentifier, literal, sanitise } from "./identifiers.js"

/** The identifiers the generated code uses. Node definitions read them off the context. */
const RUNTIME = "runtime"
const EVENT = "event"
const CURRENT_NODE = "currentNode"
/** Holds the id of the run in progress, so overlapping runs never share one. */
const CURRENT_RUN = "currentRun"

/**
 * Emits one Flow. There is a single traversal: `mode` only decides whether the
 * Tracing hooks a Node asks for turn into statements or into nothing, so
 * Development Mode and Build cannot drift apart (ADR 0001).
 */
export function compileFlow(flow: Flow, catalogue: NodeCatalogue, mode: CompilerMode): string {
  return new FlowCompiler(flow, catalogue, mode).compile()
}

class FlowCompiler {
  private readonly nodesById: ReadonlyMap<string, Node>
  private readonly prefixes: ReadonlyMap<string, string>
  /** Data output Ports whose value is already bound in the generated code. */
  private readonly bound = new Set<string>()
  /** Nodes already emitted in this run, so a cycle is reported rather than inlined forever. */
  private readonly emitted = new Set<string>()
  /** Every identifier this Flow's generated code has already used. */
  private readonly takenIdentifiers: Set<string>
  /** The identifier each Data Port's value lives in, as `nodeId.portId`. */
  private readonly portIdentifiers = new Map<string, string>()
  /** Whether the run this Flow's Tracing stamps its events with is declared yet. */
  private runDeclared = false

  constructor(
    private readonly flow: Flow,
    private readonly catalogue: NodeCatalogue,
    private readonly mode: CompilerMode
  ) {
    this.nodesById = new Map(flow.nodes.map(node => [node.id, node]))
    this.prefixes = assignIdentifierPrefixes(flow.nodes)
    this.takenIdentifiers = new Set(this.prefixes.values())
  }

  compile(): string {
    this.refuseDanglingWires()

    const triggers = this.flow.nodes.filter(node => this.definitionOf(node).isTrigger)

    const [trigger] = triggers
    if (trigger === undefined) return ""
    if (triggers.length > 1) {
      throw new CompilerError(
        `the Flow "${this.flow.name}" has ${triggers.length} Triggers; a Flow is the graph hanging off a single Trigger`,
        { flow: this.flow.id }
      )
    }

    this.emitted.add(trigger.id)
    return this.definitionOf(trigger).generate(this.contextFor(trigger, true))
  }

  /** Everything reachable from one Execution output Port, in execution order. */
  private emitFrom(node: Node, portId: string, startsRun: boolean): string {
    const definition = this.definitionOf(node)
    const port = findPort(definition, portId, node.fields)
    if (port === undefined || port.kind !== "execution" || port.direction !== "output") {
      throw new CompilerError(
        `the Node "${definition.id}" asked for the continuation of "${portId}", which is not one of its Execution output Ports`,
        { flow: this.flow.id, node: node.id }
      )
    }

    const wires = this.flow.wires.filter(
      candidate =>
        candidate.kind === "execution" &&
        candidate.from.node === node.id &&
        candidate.from.port === portId
    )

    const [wire, extra] = wires
    if (wire === undefined) return ""
    if (extra !== undefined) {
      throw new CompilerError(
        `Execution Port "${portId}" of "${node.id}" has ${wires.length} Wires leaving it, including "${extra.id}"; execution continues down exactly one`,
        { flow: this.flow.id, node: node.id }
      )
    }

    const target = this.nodeFor(wire.to.node, node.id)
    if (this.emitted.has(target.id)) {
      throw new CompilerError(
        `Execution Wire "${wire.id}" runs "${target.id}" a second time; a Flow cannot loop back on itself`,
        { flow: this.flow.id, node: target.id }
      )
    }
    this.emitted.add(target.id)

    // Claimed before the Nodes are emitted, so that a run's id is declared
    // outside the try rather than in it, where the catch could not read it.
    const runDeclaration = startsRun ? this.declareRun() : ""
    const generated = this.definitionOf(target).generate(this.contextFor(target, false))

    // The run's own declaration already records which Node is first, so only
    // the Nodes after it need to say so.
    return startsRun
      ? this.wrapRun(generated, target.id, runDeclaration)
      : joinStatements([`${CURRENT_NODE} = ${literal(target.id)}`, generated])
  }

  /**
   * A run stops at the first action that fails and reports it. A Failure Port
   * that is connected will divert execution before reaching here; leaving it
   * unconnected is what ends the Flow.
   */
  private wrapRun(body: string, firstNodeId: string, runDeclaration: string): string {
    // A failure is the end of a run, so it is reported with the run's id: the
    // Canvas marks the Node it stopped at, in the run the user was watching.
    // A Build numbers no runs and so reports none.
    const failure = [`flow: ${literal(this.flow.id)}`, `node: ${CURRENT_NODE}`, "error"]
    if (this.mode !== "build") failure.push(`run: ${CURRENT_RUN}`)

    return joinStatements([
      runDeclaration,
      `let ${CURRENT_NODE} = ${literal(firstNodeId)}`,
      "try {",
      indent(body),
      "} catch (error) {",
      indent(`${RUNTIME}.reportFailure({ ${failure.join(", ")} })`),
      "}"
    ])
  }

  private contextFor(node: Node, isTrigger: boolean): GenerationContext {
    const definition = this.definitionOf(node)

    return {
      mode: this.mode,
      runtime: RUNTIME,
      event: EVENT,
      literal,
      field: id => this.fieldOf(node, definition, id),
      input: id => this.inputExpression(node, definition, id),
      output: id => {
        const port = findPort(definition, id, node.fields)
        if (port === undefined || port.kind !== "data" || port.direction !== "output") {
          throw new CompilerError(
            `the Node "${definition.id}" bound "${id}", which is not one of its Data output Ports`,
            { flow: this.flow.id, node: node.id }
          )
        }
        this.bound.add(`${node.id}.${id}`)
        return this.identifierFor(node, id)
      },
      continuation: portId => this.emitFrom(node, portId, isTrigger),
      trace: request => this.traceStatement(node, request)
    }
  }

  private traceStatement(node: Node, request: TraceRequest): string {
    if (this.mode === "build") return ""

    const event = `{ kind: ${literal(request.kind)}, run: ${CURRENT_RUN}, flow: ${literal(this.flow.id)}, node: ${literal(node.id)} }`
    return joinStatements([this.declareRun(), `${RUNTIME}.trace(${event})`])
  }

  /**
   * The statement that begins a run, the first time something needs the run's
   * id and nothing after that.
   *
   * Everything a run reports is stamped with it, and it is a local rather than
   * something the Runtime holds because two people can use the same command at
   * the same time: a run in progress must not be able to see another one's id.
   */
  private declareRun(): string {
    if (this.mode === "build" || this.runDeclared) return ""
    this.runDeclared = true
    return `const ${CURRENT_RUN} = ${RUNTIME}.startRun()`
  }

  private fieldOf(node: Node, definition: NodeDefinition, id: string): FieldValue {
    const field = findField(definition, id)
    if (field === undefined) {
      throw new CompilerError(`the Node "${definition.id}" has no field "${id}"`, {
        flow: this.flow.id,
        node: node.id
      })
    }
    return node.fields[id] ?? defaultFieldValue(field)
  }

  /**
   * A Data input reads from its Wire when one is connected, through whatever
   * Coercion the two Port types need, and from the Node's own field otherwise.
   */
  private inputExpression(node: Node, definition: NodeDefinition, id: string): string {
    const port = findPort(definition, id, node.fields)
    if (port === undefined || port.kind !== "data" || port.direction !== "input") {
      throw new CompilerError(
        `the Node "${definition.id}" read "${id}", which is not one of its Data input Ports`,
        { flow: this.flow.id, node: node.id }
      )
    }

    const wires = this.flow.wires.filter(
      candidate =>
        candidate.kind === "data" && candidate.to.node === node.id && candidate.to.port === id
    )

    const [wire, extra] = wires
    if (wire === undefined) return literal(this.fieldOf(node, definition, id))
    if (extra !== undefined) {
      throw new CompilerError(
        `Data input Port "${id}" of "${node.id}" has ${wires.length} Wires arriving at it, including "${extra.id}"; a Data input reads exactly one value`,
        { flow: this.flow.id, node: node.id }
      )
    }

    const source = this.nodeFor(wire.from.node, node.id)
    const sourceDefinition = this.definitionOf(source)
    const sourcePort = findPort(sourceDefinition, wire.from.port, source.fields)
    if (
      sourcePort === undefined ||
      sourcePort.kind !== "data" ||
      sourcePort.direction !== "output"
    ) {
      throw new CompilerError(
        `Data Wire "${wire.id}" reads "${wire.from.port}", which is not a Data output Port of "${sourceDefinition.id}"`,
        { flow: this.flow.id, node: source.id }
      )
    }

    if (!this.bound.has(`${source.id}.${wire.from.port}`)) {
      throw new CompilerError(
        `Data Wire "${wire.id}" carries a value from "${source.id}", which does not run before "${node.id}"`,
        { flow: this.flow.id, node: node.id }
      )
    }

    const bound = this.identifierFor(source, wire.from.port)
    const expression = this.coerced(bound, wire.id, sourcePort.dataType, port.dataType, node)

    return this.traceWire(wire.id, expression)
  }

  /** Puts a Wire's value through the Coercion the two Ports need, if any. */
  private coerced(
    expression: string,
    wireId: string,
    from: DataType,
    to: DataType,
    node: Node
  ): string {
    if (from === to) return expression

    const coercion = findCoercion(from, to)
    if (coercion === undefined) {
      throw new CompilerError(
        `Data Wire "${wireId}" carries ${from} into ${to}, and no Coercion exists between them`,
        { flow: this.flow.id, node: node.id }
      )
    }
    return applyCoercion(expression, coercion, RUNTIME)
  }

  /**
   * Reports the value a Wire carried, around the expression that reads it.
   *
   * It wraps the Coercion rather than the value before it, because what the
   * user is shown on a Wire has to be what arrived at the other end of it: a
   * User drawn into a text field carried the mention, not the User.
   */
  private traceWire(wireId: string, expression: string): string {
    if (this.mode === "build") return expression
    return `${RUNTIME}.traceWire(${CURRENT_RUN}, ${literal(this.flow.id)}, ${literal(wireId)}, ${expression})`
  }

  private definitionOf(node: Node): NodeDefinition {
    const definition = this.catalogue.get(node.type)
    if (definition === undefined) {
      throw new CompilerError(
        `the Node "${node.id}" is of type "${node.type}", which is not in the catalogue`,
        { flow: this.flow.id, node: node.id }
      )
    }
    return definition
  }

  /**
   * The identifier one Data Port's value lives in.
   *
   * It is assigned once and remembered rather than spelled out wherever it is
   * needed, because a Port id is not an identifier: a slash command parameter's
   * Port is named after text the user typed, and two names that sanitise to the
   * same thing must still end up in two different variables.
   */
  private identifierFor(node: Node, portId: string): string {
    const key = `${node.id}.${portId}`
    const existing = this.portIdentifiers.get(key)
    if (existing !== undefined) return existing

    const identifier = claimIdentifier(
      this.takenIdentifiers,
      `${this.prefixOf(node)}_${sanitise(portId)}`
    )
    this.portIdentifiers.set(key, identifier)
    return identifier
  }

  /**
   * Refuses a Flow holding a Wire whose Port is no longer there.
   *
   * Editing a slash command's parameters takes Ports away, and the Wires drawn
   * to them stop meaning anything. Emitting anyway is the one outcome that is
   * not allowed: a Data input silently falling back to its inline field is a
   * bot answering with the wrong text and nothing at all saying why.
   */
  private refuseDanglingWires(): void {
    const [dangling] = findDanglingWires(this.flow, this.catalogue)
    if (dangling === undefined) return

    // The end that actually lost its Port, which is the Node the editor has to
    // mark: a renamed slash command parameter is the common case, and that is
    // the Wire's source, not the Node reading from it.
    const [end] = danglingEndsOf(this.flow, this.catalogue, dangling)

    throw new CompilerError(
      `Wire "${dangling.id}" is drawn to a Port that no longer exists; remove it or restore the Port it named`,
      { flow: this.flow.id, node: (end ?? dangling.to).node }
    )
  }

  /** The identifier prefix a Node's Data outputs are bound under. */
  private prefixOf(node: Node): string {
    const prefix = this.prefixes.get(node.id)
    if (prefix === undefined) {
      throw new CompilerError(`the Node "${node.id}" is not in this Flow`, {
        flow: this.flow.id,
        node: node.id
      })
    }
    return prefix
  }

  private nodeFor(id: string, from: string): Node {
    const node = this.nodesById.get(id)
    if (node === undefined) {
      throw new CompilerError(`"${from}" points at Node "${id}", which is not in this Flow`, {
        flow: this.flow.id,
        node: from
      })
    }
    return node
  }
}
