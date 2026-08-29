import { clampZoom, offsetForPreviewZoom } from "@/lib/preview-viewport"

import type { PreviewPoint } from "@/lib/preview-viewport"

export const EXPLODED_VIEW_MIN_ZOOM = 0.55
export const EXPLODED_VIEW_MAX_ZOOM = 1.8

export function clampExplodedViewZoom(value: number) {
  return clampZoom(value, EXPLODED_VIEW_MIN_ZOOM, EXPLODED_VIEW_MAX_ZOOM)
}

interface ExplodedViewPinchTransform {
  center: PreviewPoint
  distance: number
  initialDistance: number
  initialMidpoint: PreviewPoint
  initialPan: PreviewPoint
  initialZoom: number
  midpoint: PreviewPoint
}

/** Keeps the initial focal point stable while applying pinch scale and midpoint movement. */
export function explodedViewPinchTransform({
  center,
  distance,
  initialDistance,
  initialMidpoint,
  initialPan,
  initialZoom,
  midpoint,
}: ExplodedViewPinchTransform) {
  const zoom = clampExplodedViewZoom(initialZoom * (distance / initialDistance))
  const anchoredPan = offsetForPreviewZoom(initialPan, initialMidpoint, initialZoom, zoom, center)
  return {
    pan: {
      x: anchoredPan.x + midpoint.x - initialMidpoint.x,
      y: anchoredPan.y + midpoint.y - initialMidpoint.y,
    },
    zoom,
  }
}
