import { DASHED_BORDER_STROKE_WIDTH, getShapeContainerRadius } from "@/lib/rounded-surface-geometry"
import { useShape } from "@/lib/shape-context"
import { cn } from "@/lib/utils"

interface DashedBorderProps {
  className?: string
}

export function DashedBorder({ className }: DashedBorderProps) {
  const shape = useShape()
  const radius = getShapeContainerRadius(shape.container)

  return (
    <svg
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 z-10 size-full", className)}
    >
      <rect
        x="0.5"
        y="0.5"
        width="calc(100% - 1px)"
        height="calc(100% - 1px)"
        rx={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={DASHED_BORDER_STROKE_WIDTH}
        strokeDasharray="6 7"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
