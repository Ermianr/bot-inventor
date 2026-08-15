import { catalogue, type NodeDefinition } from "@bot-inventor/nodes"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from "@bot-inventor/ui/components/command"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from "@bot-inventor/ui/components/context-menu"
import { type ReactNode, useState } from "react"
import { translate, translateDefinitionKey } from "@/i18n/messages"

/**
 * Putting a Node on the Canvas: right-click, "Add a node", then the catalogue
 * as a list you type into.
 *
 * The list is flat and searched by the Node's translated label, because the
 * user is looking for the words the Canvas would show them — a Node they know
 * as "Responder" is not one they will find under `discord.interaction.reply`,
 * and the id is not text they are ever shown. It is flat rather than grouped
 * for the same reason: a catalogue small enough to read is one where a
 * category is a second decision before the first one.
 *
 * Where the Node lands is where the right-click happened, in screen
 * coordinates. Turning those into Canvas coordinates is the Canvas's job — it
 * is the one holding React Flow's viewport — so this hands the point back
 * untouched.
 */
export function AddNodeMenu({
  children,
  place
}: {
  children: ReactNode
  /** Where on the screen the user asked for the Node, in client coordinates. */
  place: (definition: NodeDefinition, at: { x: number; y: number }) => void
}) {
  /**
   * Where the right-click that opened the menu happened. It is kept because the
   * point is gone by the time the user has picked a Node: the menu closes, the
   * list opens, and neither of those events knows where the gesture started.
   */
  const [at, setAt] = useState({ x: 0, y: 0 })
  const [picking, setPicking] = useState(false)

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger className="h-full w-full" data-testid="canvas-context-menu-area">
          {/*
            The menu belongs to empty Canvas, so a right-click that landed on a
            Node never reaches the trigger. This is a capture-phase handler on
            an element inside the trigger, which is what lets it stop the event
            before the trigger's own listener sees it.
          */}
          <div
            className="h-full w-full"
            onContextMenuCapture={event => {
              if (event.target instanceof Element && event.target.closest(".react-flow__node")) {
                event.stopPropagation()
                return
              }
              setAt({ x: event.clientX, y: event.clientY })
            }}
          >
            {children}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem data-testid="canvas-add-node" onClick={() => setPicking(true)}>
            {translate("canvas.addNode")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <CommandDialog
        description={translate("canvas.addNode.help")}
        onOpenChange={setPicking}
        open={picking}
        title={translate("canvas.addNode.title")}
      >
        <Command data-testid="add-node-list">
          <CommandInput placeholder={translate("canvas.addNode.search")} />
          <CommandList>
            <CommandEmpty>{translate("canvas.addNode.noMatch")}</CommandEmpty>
            {[...catalogue.values()].map(definition => (
              <CommandItem
                key={definition.id}
                data-testid={`add-node-${definition.id}`}
                onSelect={() => {
                  setPicking(false)
                  place(definition, at)
                }}
                // What the list searches. It is the label alone: the id is not
                // text the user has ever been shown, and a Node found by typing
                // one is a Node found by accident.
                value={translateDefinitionKey(definition.labelKey)}
              >
                {translateDefinitionKey(definition.labelKey)}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
