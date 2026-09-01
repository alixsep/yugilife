import { createElement } from "react"

import { motion } from "framer-motion"

import { usePreviewPlayground } from "@/hooks/use-preview-playground"
import { Elevated } from "@/lib/elevated"
import { useIcon } from "@/lib/icon-context"
import { useShape } from "@/lib/shape-context"
import { cn } from "@/lib/utils"

import { Button } from "./button"
import { Tooltip, TooltipProvider } from "./tooltip"

import type { MouseEvent, ReactNode } from "react"

interface PreviewPlaygroundProps {
  actions?: ReactNode
  children: ReactNode
  className?: string
  contentHeight: number
  contentWidth: number
  label?: string
  onContentDoubleClick?: ((event: MouseEvent<HTMLDivElement>) => boolean) | undefined
}

export function PreviewPlayground({
  actions,
  children,
  className,
  contentHeight,
  contentWidth,
  label = "Preview playground",
  onContentDoubleClick,
}: PreviewPlaygroundProps) {
  const shape = useShape()
  const FitIcon = useIcon("scaling")
  const ZoomInIcon = useIcon("zoom-in")
  const ZoomOutIcon = useIcon("zoom-out")
  const {
    canZoomIn,
    canZoomOut,
    contentStyle,
    dragging,
    playgroundProps,
    playgroundRef,
    resetView,
    zoomIn,
    zoomOut,
  } = usePreviewPlayground({
    contentHeight,
    contentWidth,
    onDoubleClick: onContentDoubleClick,
  })

  return (
    <div
      {...playgroundProps}
      ref={playgroundRef}
      aria-label={label}
      aria-roledescription="pan and zoom canvas"
      className={cn(
        "bg-muted/50 relative size-full min-h-0 min-w-0 touch-none overflow-hidden outline-none select-none",
        dragging ? "cursor-grabbing" : "cursor-grab",
        shape.container,
        className,
      )}
      data-cursor="drag"
      role="region"
      tabIndex={0}
    >
      <motion.div className="pointer-events-none absolute" style={contentStyle}>
        {children}
      </motion.div>

      {actions && (
        <div
          className="absolute top-3 right-3 z-20 sm:top-4 sm:right-4"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {actions}
        </div>
      )}

      <TooltipProvider>
        <Elevated
          className={cn(
            "border-border absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 border p-1",
            shape.container,
          )}
          offset={2}
          shadowLevel={3}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Tooltip content="Zoom out" side="top">
            <Button
              aria-label="Zoom out"
              disabled={!canZoomOut}
              size="icon"
              variant="ghost"
              onClick={zoomOut}
            >
              {createElement(ZoomOutIcon)}
            </Button>
          </Tooltip>
          <Tooltip content="Fit preview" side="top">
            <Button aria-label="Fit preview" size="icon" variant="ghost" onClick={resetView}>
              {createElement(FitIcon)}
            </Button>
          </Tooltip>
          <Tooltip content="Zoom in" side="top">
            <Button
              aria-label="Zoom in"
              disabled={!canZoomIn}
              size="icon"
              variant="ghost"
              onClick={zoomIn}
            >
              {createElement(ZoomInIcon)}
            </Button>
          </Tooltip>
        </Elevated>
      </TooltipProvider>
    </div>
  )
}
