import { CURRENT_SCHEMA_VERSION, type Project } from "@bot-inventor/schema"

/**
 * The Project the editor holds.
 *
 * Until the Canvas exists there is nothing to open and nothing to edit, so this
 * stands in for it: one Flow, `/hello`, wired to a reply. Everything downstream
 * of it — compiling, running, the output panel — is the real thing, and none of
 * it knows this Project was not drawn by the user.
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
