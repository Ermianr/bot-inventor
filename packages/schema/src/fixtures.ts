import { CURRENT_SCHEMA_VERSION, type Project } from "./project.js"

/**
 * Project fixtures for tests in this package and in the ones built on top of
 * it. Every fixture is returned freshly built, so a test can mutate what it
 * gets without leaking into the next one.
 */

/**
 * Reaches into a fixture's collection, failing loudly rather than handing back
 * `undefined` when the fixture is not shaped the way the test assumed.
 */
export function requireFirst<T>(items: readonly T[], what: string): T {
  const item = items[0]
  if (item === undefined) throw new Error(`the fixture has no ${what}`)
  return item
}

/** The smallest valid Project: one empty Flow. */
export function emptyProject(): Project {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: "project-empty",
    name: "Empty Project",
    flows: [
      {
        id: "flow-main",
        name: "Main",
        nodes: [],
        wires: []
      }
    ]
  }
}

/**
 * A Project with one Flow: a slash command Trigger wired into a reply, with a
 * Data Wire carrying the command's caller into the reply text.
 */
export function greetingProject(): Project {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: "project-greeting",
    name: "Greeting Bot",
    flows: [
      {
        id: "flow-greet",
        name: "Greet",
        nodes: [
          {
            id: "node-trigger",
            type: "discord.trigger.slashCommand",
            position: { x: 0, y: 0 },
            fields: { name: "greet", description: "Greets whoever runs it" }
          },
          {
            id: "node-reply",
            type: "discord.interaction.reply",
            position: { x: 320, y: 0 },
            fields: { ephemeral: false }
          }
        ],
        wires: [
          {
            id: "wire-execution",
            kind: "execution",
            from: { node: "node-trigger", port: "next" },
            to: { node: "node-reply", port: "in" }
          },
          {
            id: "wire-data",
            kind: "data",
            from: { node: "node-trigger", port: "user" },
            to: { node: "node-reply", port: "content" }
          }
        ]
      }
    ]
  }
}

/**
 * A Project with one Flow: `/hello` answered with a fixed piece of text typed
 * into the Reply Node, with no Data Wire involved.
 */
export function helloProject(): Project {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: "project-hello",
    name: "Hello Bot",
    flows: [
      {
        id: "flow-hello",
        name: "Hello",
        nodes: [
          {
            id: "node-trigger",
            type: "discord.trigger.slashCommand",
            position: { x: 0, y: 0 },
            fields: { name: "hello", description: "Says hello" }
          },
          {
            id: "node-reply",
            type: "discord.interaction.reply",
            position: { x: 320, y: 0 },
            fields: { content: "Hello!", ephemeral: false }
          }
        ],
        wires: [
          {
            id: "wire-execution",
            kind: "execution",
            from: { node: "node-trigger", port: "next" },
            to: { node: "node-reply", port: "in" }
          }
        ]
      }
    ]
  }
}

/**
 * A Project whose slash command asks its caller for values: the Trigger's
 * `parameters` field is what ends up registered with Discord as the command's
 * options.
 */
export function parameterisedCommandProject(): Project {
  const project = helloProject()
  const flow = requireFirst(project.flows, "Flow")
  const trigger = requireFirst(flow.nodes, "Node")
  trigger.fields = {
    name: "greet",
    description: "Greets someone",
    parameters: [
      { name: "who", description: "Who to greet", type: "user", required: true },
      { name: "times", description: "How many times", type: "number", required: false }
    ]
  }
  return project
}

/**
 * A Project whose reply reads what the caller answered: `/echo` asks for a
 * piece of text and says it back, with a Data Wire from the parameter's Port
 * into the Reply Node.
 */
export function echoParameterProject(): Project {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: "project-echo",
    name: "Echo Bot",
    flows: [
      {
        id: "flow-echo",
        name: "Echo",
        nodes: [
          {
            id: "node-trigger",
            type: "discord.trigger.slashCommand",
            position: { x: 0, y: 0 },
            fields: {
              name: "echo",
              description: "Says something back",
              parameters: [
                { name: "message", description: "What to say", type: "text", required: true }
              ]
            }
          },
          {
            id: "node-reply",
            type: "discord.interaction.reply",
            position: { x: 320, y: 0 },
            fields: { ephemeral: false }
          }
        ],
        wires: [
          {
            id: "wire-execution",
            kind: "execution",
            from: { node: "node-trigger", port: "next" },
            to: { node: "node-reply", port: "in" }
          },
          {
            id: "wire-data",
            kind: "data",
            from: { node: "node-trigger", port: "parameter.message" },
            to: { node: "node-reply", port: "content" }
          }
        ]
      }
    ]
  }
}

/**
 * `helloProject` with a second Reply Node dropped on the Canvas and wired to
 * nothing: it is part of the Project, but not part of any run.
 */
export function unreachableNodeProject(): Project {
  const project = helloProject()
  const flow = requireFirst(project.flows, "Flow")
  flow.nodes.push({
    id: "node-orphan",
    type: "discord.interaction.reply",
    position: { x: 320, y: 240 },
    fields: { content: "Nobody asked for this", ephemeral: false }
  })
  return project
}

/** A Project claiming a format this build does not know how to read. */
export function futureVersionProject(): unknown {
  return { ...greetingProject(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 }
}

/** A Project whose Wire points at a Node that is not in its Flow. */
export function danglingWireProject(): unknown {
  const project = greetingProject()
  const flow = requireFirst(project.flows, "Flow")
  flow.wires = [
    {
      id: "wire-execution",
      kind: "execution",
      from: { node: "node-trigger", port: "next" },
      to: { node: "node-missing", port: "in" }
    }
  ]
  return project
}
