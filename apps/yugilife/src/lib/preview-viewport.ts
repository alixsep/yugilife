export interface PreviewPoint {
  x: number
  y: number
}

export interface PreviewSize {
  height: number
  width: number
}

export interface PreviewPinchGesture {
  distance: number
  midpoint: PreviewPoint
}

export const PREVIEW_MIN_ZOOM = 0.25
export const PREVIEW_MAX_ZOOM = 4
export const PREVIEW_ZOOM_STEP = 1.2

export function clampPreviewZoom(value: number) {
  return Math.min(PREVIEW_MAX_ZOOM, Math.max(PREVIEW_MIN_ZOOM, value))
}

export function previewPinchGesture(
  points: readonly PreviewPoint[],
): PreviewPinchGesture | undefined {
  const [first, second] = points
  if (!first || !second) return undefined
  return {
    distance: Math.hypot(second.x - first.x, second.y - first.y),
    midpoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
  }
}

export function fitPreviewScale(viewport: PreviewSize, content: PreviewSize, padding: number) {
  if (viewport.width <= 0 || viewport.height <= 0) return 0.01
  return Math.min(
    1,
    Math.max(
      0.01,
      Math.min(
        Math.max(0, viewport.width - padding * 2) / content.width,
        Math.max(0, viewport.height - padding * 2) / content.height,
      ),
    ),
  )
}

export function offsetForPreviewZoom(
  offset: PreviewPoint,
  focalPoint: PreviewPoint,
  currentZoom: number,
  nextZoom: number,
): PreviewPoint {
  const ratio = nextZoom / currentZoom
  return {
    x: focalPoint.x - (focalPoint.x - offset.x) * ratio,
    y: focalPoint.y - (focalPoint.y - offset.y) * ratio,
  }
}
