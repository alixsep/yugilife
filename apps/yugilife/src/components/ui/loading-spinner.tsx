import { cn } from "@/lib/utils"

import type { SVGAttributes } from "react"

export type LoadingSpinnerSize = "inline" | "compact" | "default"

interface LoadingSpinnerProps extends SVGAttributes<SVGSVGElement> {
  size?: LoadingSpinnerSize
}

const sizeClasses: Record<LoadingSpinnerSize, string> = {
  inline: "h-4 w-4",
  compact: "h-7 w-7",
  default: "h-9 w-9",
}

/** The shared infinite loader used by buttons and inline asynchronous controls. */
export function LoadingSpinner({ className, size = "default", ...props }: LoadingSpinnerProps) {
  const labelled = props["aria-label"] !== undefined
  return (
    <svg
      aria-hidden={labelled ? undefined : true}
      className={cn(sizeClasses[size], className)}
      fill="none"
      viewBox="0 0 24 24"
      {...props}
    >
      <path
        d="M 12 12 C 14 8.5 19 8.5 19 12 C 19 15.5 14 15.5 12 12 C 10 8.5 5 8.5 5 12 C 5 15.5 10 15.5 12 12 Z"
        stroke="currentColor"
        strokeWidth="1.125"
        strokeLinecap="round"
        pathLength="100"
        style={{
          strokeDasharray: "15 85",
          animation: "spinner-move 2s linear infinite, spinner-dash 4s ease-in-out infinite",
        }}
      />
    </svg>
  )
}
