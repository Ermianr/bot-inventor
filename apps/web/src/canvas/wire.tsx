import type { WireKind } from "@bot-inventor/schema"
import { Tooltip, TooltipContent, TooltipTrigger } from "@bot-inventor/ui/components/tooltip"
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  type Edge as ReactFlowEdge
} from "@xyflow/react"
import { translate, translateDefinitionKey } from "@/i18n/messages"

/**
 * A Wire between two Ports.
 *
 * When the Wire converts what it carries, the Coercion is written on it: a
 * conversion the user can see is a decision they made, and one they cannot is
 * something that happened to them.
 *
 * While a bot is running, the value the Wire carried in the most recent run is
 * written on it too, which is the whole point of watching a Flow run: a graph
 * becomes something a person understands when they can read what went through.
 */

export type WireData = {
  kind: WireKind
  /** The Coercion this Wire applies, or `undefined` when it carries the value as it is. */
  coercionLabelKey: string | undefined
  /** What this Wire carried in the run being watched, ready to read. */
  carried: string | undefined
  remove: (wireId: string) => void
}

/** How much of a value fits on a Wire before the rest is left to the tooltip. */
const CARRIED_LIMIT = 32

export type WireType = ReactFlowEdge<WireData, "wire">

export function Wire({
  data,
  id,
  sourcePosition,
  sourceX,
  sourceY,
  targetPosition,
  targetX,
  targetY
}: EdgeProps<WireType>) {
  const [path, labelX, labelY] = getBezierPath({
    sourcePosition,
    sourceX,
    sourceY,
    targetPosition,
    targetX,
    targetY
  })

  return (
    <>
      {/*
        An Execution Wire is drawn solid and a Data Wire dashed. The refusal
        the editor gives for mixing them talks about order wires and value
        wires, and it can only do that if the two look different.
      */}
      <BaseEdge
        id={id}
        path={path}
        style={data?.kind === "data" ? { strokeDasharray: "6 4" } : undefined}
      />
      <EdgeLabelRenderer>
        <div
          className="pointer-events-auto absolute flex items-center gap-1"
          data-testid={`wire-${id}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {data?.carried !== undefined && (
            <Tooltip>
              <TooltipTrigger
                render={<span />}
                aria-label={translate("canvas.wire.carried", { value: data.carried })}
                className="max-w-40 truncate rounded-full border border-amber-500/60 bg-background px-2 py-0.5 font-mono text-[10px]"
                data-testid={`wire-carried-${id}`}
                // The badge is cut short to fit the Wire, so what it says out
                // loud, and what a pointer resting on it shows, is the whole
                // value: the value is the thing the user came to read. The
                // editor shows it, not the operating system.
                role="note"
              >
                {data.carried.length > CARRIED_LIMIT
                  ? `${data.carried.slice(0, CARRIED_LIMIT)}…`
                  : data.carried}
              </TooltipTrigger>
              {/* A carried value can be one long unbroken run of characters,
                  which has nowhere to wrap without being told to. */}
              <TooltipContent className="break-all font-mono">{data.carried}</TooltipContent>
            </Tooltip>
          )}
          {data?.coercionLabelKey !== undefined && (
            <span
              className="rounded-full border bg-background px-2 py-0.5 text-[10px]"
              data-testid={`wire-coercion-${id}`}
            >
              {translateDefinitionKey(data.coercionLabelKey)}
            </span>
          )}
          <button
            aria-label={translate("canvas.wire.remove")}
            className="rounded-full border bg-background px-1.5 text-[10px] leading-4"
            data-testid={`wire-remove-${id}`}
            onClick={() => data?.remove(id)}
            type="button"
          >
            ×
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
