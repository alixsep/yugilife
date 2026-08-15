"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { animate, motionValue } from "framer-motion"

import {
  clampPreviewZoom,
  fitPreviewScale,
  offsetForPreviewZoom,
  PREVIEW_MAX_ZOOM,
  PREVIEW_MIN_ZOOM,
  PREVIEW_ZOOM_STEP,
  previewPinchGesture,
} from "@/lib/preview-viewport"
import { spring } from "@/lib/springs"

import type { KeyboardEvent, PointerEvent } from "react"

interface UsePreviewPlaygroundOptions {
  contentHeight: number
  contentWidth: number
  padding?: number
}

interface PreviewLayout {
  height: number
  left: number
  top: number
  width: number
}

function createPreviewMotionValues() {
  return {
    height: motionValue(1),
    left: motionValue(0),
    top: motionValue(0),
    width: motionValue(1),
  }
}

export function usePreviewPlayground({
  contentHeight,
  contentWidth,
  padding = 32,
}: UsePreviewPlaygroundOptions) {
  const playgroundRef = useRef<HTMLDivElement>(null)
  const activePointers = useRef(new Map<number, { x: number; y: number }>())
  const previousPinch = useRef<ReturnType<typeof previewPinchGesture>>(undefined)
  const hasMeasuredLayout = useRef(false)
  const offsetRef = useRef({ x: 0, y: 0 })
  const zoomRef = useRef(1)
  const [motionValues] = useState(createPreviewMotionValues)
  const { height, left, top, width } = motionValues
  const [dragging, setDragging] = useState(false)
  const [viewport, setViewport] = useState({ height: 0, width: 0 })
  const [zoomLimits, setZoomLimits] = useState({ canZoomIn: true, canZoomOut: true })
  const fitScale = fitPreviewScale(
    viewport,
    { height: contentHeight, width: contentWidth },
    padding,
  )

  const layoutFor = useCallback(
    (zoom: number, offset = offsetRef.current): PreviewLayout => {
      const nextWidth = contentWidth * fitScale * zoom
      const nextHeight = contentHeight * fitScale * zoom
      return {
        height: nextHeight,
        left: (viewport.width - nextWidth) / 2 + offset.x,
        top: (viewport.height - nextHeight) / 2 + offset.y,
        width: nextWidth,
      }
    },
    [contentHeight, contentWidth, fitScale, viewport.height, viewport.width],
  )

  useEffect(() => {
    const playground = playgroundRef.current
    if (!playground || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      setViewport((current) => {
        const next = { height: entry.contentRect.height, width: entry.contentRect.width }
        return current.height === next.height && current.width === next.width ? current : next
      })
    })
    observer.observe(playground)
    return () => observer.disconnect()
  }, [])

  useEffect(
    () => () => {
      height.destroy()
      left.destroy()
      top.destroy()
      width.destroy()
    },
    [height, left, top, width],
  )

  useEffect(() => {
    const next = layoutFor(zoomRef.current)
    if (!hasMeasuredLayout.current) {
      height.set(next.height)
      left.set(next.left)
      top.set(next.top)
      width.set(next.width)
      if (viewport.height > 0 && viewport.width > 0) hasMeasuredLayout.current = true
      return
    }
    animate(height, next.height, spring.moderate)
    animate(left, next.left, spring.moderate)
    animate(top, next.top, spring.moderate)
    animate(width, next.width, spring.moderate)
  }, [height, layoutFor, left, top, viewport.height, viewport.width, width])

  const resetView = useCallback(() => {
    zoomRef.current = 1
    offsetRef.current = { x: 0, y: 0 }
    setZoomLimits({ canZoomIn: true, canZoomOut: true })
    const next = layoutFor(1)
    animate(height, next.height, spring.moderate)
    animate(left, next.left, spring.moderate)
    animate(top, next.top, spring.moderate)
    animate(width, next.width, spring.moderate)
  }, [height, layoutFor, left, top, width])

  const zoomAt = useCallback(
    (
      requestedZoom: number,
      focalPoint = { x: viewport.width / 2, y: viewport.height / 2 },
      transition: "direct" | "animated" = "animated",
    ) => {
      const currentZoom = zoomRef.current
      const nextZoom = clampPreviewZoom(requestedZoom)
      if (nextZoom === currentZoom) return

      const nextSize = {
        height: contentHeight * fitScale * nextZoom,
        width: contentWidth * fitScale * nextZoom,
      }
      const nextPosition = offsetForPreviewZoom(
        { x: left.get(), y: top.get() },
        focalPoint,
        currentZoom,
        nextZoom,
      )
      offsetRef.current = {
        x: nextPosition.x - (viewport.width - nextSize.width) / 2,
        y: nextPosition.y - (viewport.height - nextSize.height) / 2,
      }
      zoomRef.current = nextZoom
      setZoomLimits((current) => {
        const next = {
          canZoomIn: nextZoom < PREVIEW_MAX_ZOOM,
          canZoomOut: nextZoom > PREVIEW_MIN_ZOOM,
        }
        return current.canZoomIn === next.canZoomIn && current.canZoomOut === next.canZoomOut
          ? current
          : next
      })

      if (transition === "direct") {
        height.set(nextSize.height)
        left.set(nextPosition.x)
        top.set(nextPosition.y)
        width.set(nextSize.width)
        return
      }
      animate(height, nextSize.height, spring.fast)
      animate(left, nextPosition.x, spring.fast)
      animate(top, nextPosition.y, spring.fast)
      animate(width, nextSize.width, spring.fast)
    },
    [contentHeight, contentWidth, fitScale, height, left, top, viewport, width],
  )

  const zoomIn = useCallback(() => zoomAt(zoomRef.current * PREVIEW_ZOOM_STEP), [zoomAt])
  const zoomOut = useCallback(() => zoomAt(zoomRef.current / PREVIEW_ZOOM_STEP), [zoomAt])

  useEffect(() => {
    const playground = playgroundRef.current
    if (!playground) return

    const handleWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault()
      const bounds = playground.getBoundingClientRect()
      const unit =
        event.deltaMode === globalThis.WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === globalThis.WheelEvent.DOM_DELTA_PAGE
            ? Math.max(1, bounds.height)
            : 1
      // Browsers expose touchpad pinch as a ctrl-modified wheel gesture. Its
      // deltas are intentionally smaller than a mouse wheel's, so use a more
      // responsive curve while preserving pointer-anchored zoom for both.
      const sensitivity = event.ctrlKey ? 0.01 : 0.0015
      zoomAt(
        zoomRef.current * Math.exp(-event.deltaY * unit * sensitivity),
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        "direct",
      )
    }

    playground.addEventListener("wheel", handleWheel, { passive: false })
    return () => playground.removeEventListener("wheel", handleWheel)
  }, [zoomAt])

  const panBy = useCallback(
    (x: number, y: number) => {
      const nextLeft = left.get() + x
      const nextTop = top.get() + y
      left.set(nextLeft)
      top.set(nextTop)
      offsetRef.current = {
        x: nextLeft - (viewport.width - width.get()) / 2,
        y: nextTop - (viewport.height - height.get()) / 2,
      }
    },
    [height, left, top, viewport.height, viewport.width, width],
  )

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    previousPinch.current = previewPinchGesture([...activePointers.current.values()])
    setDragging(true)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const previous = activePointers.current.get(event.pointerId)
    if (!previous) return
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (activePointers.current.size < 2) {
      panBy(event.clientX - previous.x, event.clientY - previous.y)
      return
    }

    const before = previousPinch.current
    const after = previewPinchGesture([...activePointers.current.values()])
    if (!before || !after || before.distance <= 0) return
    const bounds = event.currentTarget.getBoundingClientRect()
    zoomAt(
      zoomRef.current * (after.distance / before.distance),
      { x: before.midpoint.x - bounds.left, y: before.midpoint.y - bounds.top },
      "direct",
    )
    panBy(after.midpoint.x - before.midpoint.x, after.midpoint.y - before.midpoint.y)
    previousPinch.current = after
  }

  const stopDragging = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    activePointers.current.delete(event.pointerId)
    previousPinch.current = previewPinchGesture([...activePointers.current.values()])
    setDragging(activePointers.current.size > 0)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === " ") {
      event.preventDefault()
      return
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault()
      zoomIn()
      return
    }
    if (event.key === "-") {
      event.preventDefault()
      zoomOut()
      return
    }
    if (event.key === "0") {
      event.preventDefault()
      resetView()
      return
    }
    const distance = event.shiftKey ? 48 : 16
    const movement: Partial<Record<string, { x: number; y: number }>> = {
      ArrowDown: { x: 0, y: -distance },
      ArrowLeft: { x: distance, y: 0 },
      ArrowRight: { x: -distance, y: 0 },
      ArrowUp: { x: 0, y: distance },
    }
    const delta = movement[event.key]
    if (!delta) return
    event.preventDefault()
    const nextLeft = left.get() + delta.x
    const nextTop = top.get() + delta.y
    offsetRef.current = {
      x: nextLeft - (viewport.width - width.get()) / 2,
      y: nextTop - (viewport.height - height.get()) / 2,
    }
    animate(left, nextLeft, spring.fast)
    animate(top, nextTop, spring.fast)
  }

  return {
    canZoomIn: zoomLimits.canZoomIn,
    canZoomOut: zoomLimits.canZoomOut,
    contentStyle: { height, left, top, width },
    dragging,
    playgroundProps: {
      onDoubleClick: resetView,
      onKeyDown,
      onPointerCancel: stopDragging,
      onPointerDown,
      onPointerMove,
      onPointerUp: stopDragging,
    },
    playgroundRef,
    resetView,
    zoomIn,
    zoomOut,
  }
}
