"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { animate, motionValue, useMotionTemplate } from "framer-motion"

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
  left: number
  top: number
}

function createPreviewMotionValues() {
  return {
    left: motionValue(0),
    scale: motionValue(1),
    top: motionValue(0),
    willChange: motionValue("auto"),
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
  const transformIdleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const zoomRef = useRef(1)
  const [motionValues] = useState(createPreviewMotionValues)
  const { left, scale, top, willChange } = motionValues
  const [dragging, setDragging] = useState(false)
  const [viewport, setViewport] = useState({ height: 0, width: 0 })
  const [zoomLimits, setZoomLimits] = useState({ canZoomIn: true, canZoomOut: true })
  const fitScale = fitPreviewScale(
    viewport,
    { height: contentHeight, width: contentWidth },
    padding,
  )
  const fittedWidth = contentWidth * fitScale
  const fittedHeight = contentHeight * fitScale
  const transform = useMotionTemplate`translate3d(${left}px, ${top}px, 0) scale(${scale})`

  const markTransforming = useCallback(() => {
    willChange.set("transform")
    if (transformIdleTimer.current !== undefined) clearTimeout(transformIdleTimer.current)
    transformIdleTimer.current = setTimeout(() => {
      willChange.set("auto")
      transformIdleTimer.current = undefined
    }, 160)
  }, [willChange])

  const layoutFor = useCallback(
    (zoom: number, offset = offsetRef.current): PreviewLayout => {
      return {
        left: (viewport.width - fittedWidth * zoom) / 2 + offset.x,
        top: (viewport.height - fittedHeight * zoom) / 2 + offset.y,
      }
    },
    [fittedHeight, fittedWidth, viewport.height, viewport.width],
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
      left.destroy()
      scale.destroy()
      top.destroy()
      willChange.destroy()
    },
    [left, scale, top, willChange],
  )

  useEffect(
    () => () => {
      if (transformIdleTimer.current !== undefined) clearTimeout(transformIdleTimer.current)
    },
    [],
  )

  useEffect(() => {
    const next = layoutFor(zoomRef.current)
    if (!hasMeasuredLayout.current) {
      left.set(next.left)
      scale.set(zoomRef.current)
      top.set(next.top)
      if (viewport.height > 0 && viewport.width > 0) hasMeasuredLayout.current = true
      return
    }
    animate(left, next.left, spring.moderate)
    animate(top, next.top, spring.moderate)
  }, [layoutFor, left, scale, top, viewport.height, viewport.width])

  const resetView = useCallback(() => {
    markTransforming()
    zoomRef.current = 1
    offsetRef.current = { x: 0, y: 0 }
    setZoomLimits({ canZoomIn: true, canZoomOut: true })
    const next = layoutFor(1)
    animate(scale, 1, spring.moderate)
    animate(left, next.left, spring.moderate)
    animate(top, next.top, spring.moderate)
  }, [layoutFor, left, markTransforming, scale, top])

  const zoomAt = useCallback(
    (
      requestedZoom: number,
      focalPoint = { x: viewport.width / 2, y: viewport.height / 2 },
      transition: "direct" | "animated" = "animated",
    ) => {
      const currentZoom = zoomRef.current
      const nextZoom = clampPreviewZoom(requestedZoom)
      if (nextZoom === currentZoom) return
      markTransforming()

      const nextSize = {
        height: fittedHeight * nextZoom,
        width: fittedWidth * nextZoom,
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
        scale.set(nextZoom)
        left.set(nextPosition.x)
        top.set(nextPosition.y)
        return
      }
      animate(scale, nextZoom, spring.fast)
      animate(left, nextPosition.x, spring.fast)
      animate(top, nextPosition.y, spring.fast)
    },
    [fittedHeight, fittedWidth, left, markTransforming, scale, top, viewport],
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
      markTransforming()
      const nextLeft = left.get() + x
      const nextTop = top.get() + y
      left.set(nextLeft)
      top.set(nextTop)
      offsetRef.current = {
        x: nextLeft - (viewport.width - fittedWidth * zoomRef.current) / 2,
        y: nextTop - (viewport.height - fittedHeight * zoomRef.current) / 2,
      }
    },
    [fittedHeight, fittedWidth, left, markTransforming, top, viewport.height, viewport.width],
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
    markTransforming()
    const nextLeft = left.get() + delta.x
    const nextTop = top.get() + delta.y
    offsetRef.current = {
      x: nextLeft - (viewport.width - fittedWidth * zoomRef.current) / 2,
      y: nextTop - (viewport.height - fittedHeight * zoomRef.current) / 2,
    }
    animate(left, nextLeft, spring.fast)
    animate(top, nextTop, spring.fast)
  }

  return {
    canZoomIn: zoomLimits.canZoomIn,
    canZoomOut: zoomLimits.canZoomOut,
    contentStyle: {
      height: fittedHeight,
      left: 0,
      top: 0,
      transform,
      transformOrigin: "top left",
      width: fittedWidth,
      willChange,
    },
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
