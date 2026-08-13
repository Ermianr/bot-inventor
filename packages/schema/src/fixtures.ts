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
