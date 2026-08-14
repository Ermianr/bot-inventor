import { CURRENT_SCHEMA_VERSION, type Project } from "@bot-inventor/schema"

/**
 * The Project the editor opens with.
 *
 * Until a Project can be opened from disk, this is what the Canvas starts from:
 * one Flow, `/hello`, wired to a reply. The user edits it from the moment the
 * editor loads, and everything downstream — compiling, running, the output
 * panel — sees their edits, not this.
 */
export const currentProject: Project = {
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
