import type { WireKind } from "@bot-inventor/schema"
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
 */

export type WireData = {
  kind: WireKind
  /** The Coercion this Wire applies, or `undefined` when it carries the value as it is. */
  coercionLabelKey: string | undefined
  remove: (wireId: string) => void
}

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
      <BaseEdge id={id} path={path} />
      <EdgeLabelRenderer>
        <div
          className="pointer-events-auto absolute flex items-center gap-1"
          data-testid={`wire-${id}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
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
