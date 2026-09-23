import { forwardRef } from "react"

import { cn } from "@/lib/utils"

import type { HTMLAttributes } from "react"

interface ProgressProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  label: string
  max?: number | undefined
  value?: number | undefined
}

const Progress = forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, label, max = 100, value, ...props }, ref) => {
    const determinate =
      value !== undefined && Number.isFinite(value) && Number.isFinite(max) && max > 0
    const normalizedValue = determinate ? Math.min(max, Math.max(0, value)) : undefined
    const width = normalizedValue === undefined ? undefined : `${(normalizedValue / max) * 100}%`

    return (
      <div
        ref={ref}
        {...props}
        aria-label={label}
        aria-valuemax={determinate ? max : undefined}
        aria-valuemin={determinate ? 0 : undefined}
        aria-valuenow={normalizedValue}
        className={cn("bg-surface-2 h-1.5 w-full overflow-hidden rounded-full", className)}
        role="progressbar"
      >
        <div
          aria-hidden="true"
          className={cn(
            "bg-foreground h-full rounded-[inherit] transition-[width] duration-150 motion-reduce:transition-none",
            !determinate && "w-1/3 animate-pulse",
          )}
          style={width === undefined ? undefined : { width }}
        />
      </div>
    )
  },
)

Progress.displayName = "Progress"

export { Progress }
export type { ProgressProps }
