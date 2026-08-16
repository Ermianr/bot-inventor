import { MiniMap } from "@xyflow/react"
import type { CSSProperties } from "react"

import type { FlowNodeType } from "@/canvas/flow-node"
import { translate } from "@/i18n/messages"

/**
 * The Minimap: the whole Flow at once, in the corner of the Canvas, so a Flow
 * too big for the screen can still be navigated.
 *
 * A Node is drawn as what it is rather than as a grey box. Finding the Trigger
 * at a glance is most of what a map of a Flow is for — it is where reading one
 * starts — and a Node that failed in the last Run stays marked after everything
 * has stopped, which is when the map is actually being read.
 *
 * It does not follow the Node executing right now. Somebody watching a Run is
 * looking at the Canvas, where the Node is drawn full size and its values can
 * be read; a second thing moving in the corner is only something else to watch.
 */

/**
 * What a Node is painted, in the application's own tokens. React Flow puts
 * these on the rectangle's `style` rather than into an attribute, so a token
 * resolves here exactly as it does anywhere else and the Minimap changes with
 * the theme without being told the theme changed.
 *
 * A failure outranks being the Trigger: a Trigger that failed is a Flow that
 * never started, and the failure is the thing the user came to the map to find.
 */
export function minimapNodePaint(node: FlowNodeType): string {
  if (node.data.runState === "failed") return "var(--destructive)"
  if (node.data.definition.isTrigger) return "var(--primary)"
  return "var(--muted-foreground)"
}

/**
 * React Flow paints the Minimap's own surface and the mask over it from these
 * variables, which its stylesheet fills with colours belonging to a design
 * system that is not ours. The mask is mixed rather than named, because what it
 * is for is dimming the part of the Flow that is off screen and no token in
 * this application is a translucent one.
 */
const minimapTokens = {
  "--xy-minimap-background-color": "var(--card)",
  "--xy-minimap-mask-background-color": "color-mix(in oklab, var(--muted) 70%, transparent)",
  "--xy-minimap-mask-stroke-color": "var(--border)"
} as CSSProperties

export function FlowMinimap() {
  return (
    <MiniMap<FlowNodeType>
      ariaLabel={translate("minimap.label")}
      className="rounded-md border"
      nodeColor={minimapNodePaint}
      nodeStrokeColor="var(--border)"
      // Dragging the map moves the Canvas under it, which is the whole of what
      // "a Flow too big for the screen can still be navigated" asks for.
      // Zooming from the corner is not: it is a second set of zoom controls,
      // three inches from the ones the Canvas already has.
      pannable
      style={minimapTokens}
    />
  )
}
