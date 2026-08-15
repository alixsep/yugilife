import { useShape } from "@/lib/shape-context"
import { cn } from "@/lib/utils"

interface DashedBorderProps {
  className?: string
}

export function DashedBorder({ className }: DashedBorderProps) {
  const shape = useShape()

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
        rx={shape.container === "rounded-3xl" ? 24 : 12}
        fill="none"
        stroke="currentColor"
        strokeDasharray="6 7"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
