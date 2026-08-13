import {
  applyCoercion,
  type CompilerMode,
  findCoercion,
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
import { assignIdentifierPrefixes, literal } from "./identifiers.js"

/** The identifiers the generated code uses. Node definitions read them off the context. */
const RUNTIME = "runtime"
const EVENT = "event"
const CURRENT_NODE = "currentNode"

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

  constructor(
    private readonly flow: Flow,
    private readonly catalogue: NodeCatalogue,
    private readonly mode: CompilerMode
  ) {
    this.nodesById = new Map(flow.nodes.map(node => [node.id, node]))
    this.prefixes = assignIdentifierPrefixes(flow.nodes)
  }

  compile(): string {
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
    const port = findPort(definition, portId)
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

    const generated = this.definitionOf(target).generate(this.contextFor(target, false))

    // The run's own declaration already records which Node is first, so only
    // the Nodes after it need to say so.
    return startsRun
      ? this.wrapRun(generated, target.id)
      : joinStatements([`${CURRENT_NODE} = ${literal(target.id)}`, generated])
  }

  /**
   * A run stops at the first action that fails and reports it. A Failure Port
   * that is connected will divert execution before reaching here; leaving it
   * unconnected is what ends the Flow.
   */
  private wrapRun(body: string, firstNodeId: string): string {
    return [
      `let ${CURRENT_NODE} = ${literal(firstNodeId)}`,
      "try {",
      indent(body),
      "} catch (error) {",
      indent(
        `${RUNTIME}.reportFailure({ flow: ${literal(this.flow.id)}, node: ${CURRENT_NODE}, error })`
      ),
      "}"
    ].join("\n")
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
        const port = findPort(definition, id)
        if (port === undefined || port.kind !== "data" || port.direction !== "output") {
          throw new CompilerError(
            `the Node "${definition.id}" bound "${id}", which is not one of its Data output Ports`,
            { flow: this.flow.id, node: node.id }
          )
        }
        this.bound.add(`${node.id}.${id}`)
        return `${this.prefixOf(node)}_${id}`
      },
      continuation: portId => this.emitFrom(node, portId, isTrigger),
      trace: request => this.traceStatement(node, request)
    }
  }

  private traceStatement(node: Node, request: TraceRequest): string {
    if (this.mode === "build") return ""

    const location = `flow: ${literal(this.flow.id)}, node: ${literal(node.id)}`
    const payload =
      request.kind === "node-entered"
        ? `{ kind: "node-entered", ${location} }`
        : `{ kind: "value-produced", ${location}, port: ${literal(request.port)}, value: ${request.expression} }`

    return `${RUNTIME}.trace(${payload})`
  }

  private fieldOf(node: Node, definition: NodeDefinition, id: string): FieldValue {
    const field = findField(definition, id)
    if (field === undefined) {
      throw new CompilerError(`the Node "${definition.id}" has no field "${id}"`, {
        flow: this.flow.id,
        node: node.id
      })
    }
    return node.fields[id] ?? field.defaultValue
  }

  /**
   * A Data input reads from its Wire when one is connected, through whatever
   * Coercion the two Port types need, and from the Node's own field otherwise.
   */
  private inputExpression(node: Node, definition: NodeDefinition, id: string): string {
    const port = findPort(definition, id)
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
    const sourcePort = findPort(sourceDefinition, wire.from.port)
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

    const expression = `${this.prefixOf(source)}_${wire.from.port}`
    if (sourcePort.dataType === port.dataType) return expression

    const coercion = findCoercion(sourcePort.dataType, port.dataType)
    if (coercion === undefined) {
      throw new CompilerError(
        `Data Wire "${wire.id}" carries ${sourcePort.dataType} into ${port.dataType}, and no Coercion exists between them`,
        { flow: this.flow.id, node: node.id }
      )
    }
    return applyCoercion(expression, coercion, RUNTIME)
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
