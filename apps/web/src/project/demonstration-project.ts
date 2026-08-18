import { literalText, type Project } from "@bot-inventor/schema"
import { helloProject } from "@bot-inventor/schema/fixtures"

/**
 * A Project to look at before the user has built one: `/hello` wired to a
 * reply, and a second Flow beside it doing the same for `/goodbye`.
 *
 * This is what the Dashboard's example button makes — see `use-projects.ts` —
 * so that both a first-time user and the end-to-end specs have a Canvas with
 * something on it without anybody having to wire one up first.
 *
 * The first Flow is the schema package's own `helloProject`, with a Slot put
 * into its reply so that the Canvas has a hole a value can be wired into: a
 * Slotted field is where a Data Wire arrives now (ADR 0010), and a Project to
 * look at with nowhere to draw one shows half of what the editor does.
 *
 * It is otherwise that fixture rather than a
 * second copy of the same Nodes: the end-to-end tests read this Canvas and the
 * unit tests read that fixture, and two copies would drift the first time a
 * Node changes. The second Flow exists so the list has two rows to choose
 * between and two names that cannot be the same, which is what the Flow list is
 * for and what its specs read; it carries its own Nodes so that switching to it
 * shows a Canvas rather than an empty one. Its Node ids are prefixed, since a
 * Wire addresses a Node by id and the two Flows would otherwise share names.
 */
export function demonstrationProject(): Project {
  const project = helloProject()
  const hello = project.flows[0]
  const reply = hello?.nodes[1]
  if (reply === undefined) throw new Error("the Hello Flow has no Reply Node")
  reply.fields = {
    ...reply.fields,
    content: [
      { kind: "literal", text: "Hello, " },
      { kind: "slot", slot: "slot-who" }
    ]
  }

  return {
    ...project,
    flows: [
      ...project.flows,
      {
        id: "flow-goodbye",
        name: "Goodbye",
        nodes: [
          {
            id: "node-goodbye-trigger",
            type: "discord.trigger.slashCommand",
            position: { x: 0, y: 0 },
            fields: { name: "goodbye", description: "Says goodbye" }
          },
          {
            id: "node-goodbye-reply",
            type: "discord.interaction.reply",
            position: { x: 320, y: 0 },
            fields: { content: literalText("Goodbye!"), ephemeral: false }
          }
        ],
        wires: [
          {
            id: "wire-goodbye-execution",
            kind: "execution",
            from: { node: "node-goodbye-trigger", port: "next" },
            to: { node: "node-goodbye-reply", port: "in" }
          }
        ]
      }
    ]
  }
}
