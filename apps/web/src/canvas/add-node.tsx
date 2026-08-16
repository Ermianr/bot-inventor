import type { NodeChoice, NodeDefinition } from "@bot-inventor/nodes"
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
 * A Node the Flow cannot be given — a second Trigger — is listed all the same,
 * not selectable and with the reason written next to it. Which those are is
 * decided before the list is rendered, by `addableNodes`.
 *
 * Where the Node lands is where the right-click happened, in screen
 * coordinates. Turning those into Canvas coordinates is the Canvas's job — it
 * is the one holding React Flow's viewport — so this hands the point back
 * untouched.
 */
/**
 * A point on the screen, in client coordinates. It is not a `Position`: a
 * Position is where something sits in the Flow, and the two are only the same
 * on a Canvas nobody has panned or zoomed.
 */
export type ScreenPoint = { x: number; y: number }

/** Where the reason a Node was refused is written, for the item to point at. */
function reasonId(definitionId: string): string {
  return `add-node-reason-${definitionId}`
}

export function AddNodeMenu({
  children,
  choices,
  landsOnNode,
  place
}: {
  children: ReactNode
  /**
   * The catalogue, each Node already answered for the Flow it would be added
   * to. The list renders that answer and does not re-derive it: which Nodes a
   * Flow can still be given is a rule about Flows, not about a dialog.
   */
  choices: readonly NodeChoice[]
  /**
   * Whether a pointer gesture landed on a Node rather than on empty Canvas.
   * It is asked rather than answered here, because what a Node looks like in
   * the document is React Flow's vocabulary and the Canvas is where that is
   * spoken.
   */
  landsOnNode: (target: EventTarget | null) => boolean
  /** Puts a Node of the catalogue where the user asked for it. */
  place: (definition: NodeDefinition, at: ScreenPoint) => void
}) {
  /**
   * Where the right-click that opened the menu happened. It is kept because the
   * point is gone by the time the user has picked a Node: the menu closes, the
   * list opens, and neither of those events knows where the gesture started.
   */
  const [at, setAt] = useState<ScreenPoint>({ x: 0, y: 0 })
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
              if (landsOnNode(event.target)) {
                // The browser's own menu is turned down as well as ours: a
                // right-click that offers the editor's menu in one place and
                // Chrome's in another reads as the application breaking. What a
                // Node offers on a right-click is a later ticket's answer.
                event.preventDefault()
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
        title={translate("canvas.addNode")}
      >
        <Command data-testid="add-node-list">
          <CommandInput placeholder={translate("canvas.addNode.search")} />
          <CommandList>
            <CommandEmpty>{translate("canvas.addNode.noMatch")}</CommandEmpty>
            {choices.map(({ definition, addable, refusalKey }) => (
              <CommandItem
                key={definition.id}
                // The reason is named to the item, so a screen reader reads why
                // the Node is refused rather than only that it is disabled.
                aria-describedby={refusalKey === undefined ? undefined : reasonId(definition.id)}
                data-testid={`add-node-${definition.id}`}
                disabled={!addable}
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
                {refusalKey === undefined ? null : (
                  <span
                    className="ml-auto text-muted-foreground text-xs"
                    id={reasonId(definition.id)}
                  >
                    {translateDefinitionKey(refusalKey)}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
