import { describe, expect, it } from "vitest"

import { clampZoom, offsetForPreviewZoom, previewPinchGesture } from "./preview-viewport"

describe("preview gestures", () => {
  it("derives pinch distance and midpoint from two active pointers", () => {
    expect(
      previewPinchGesture([
        { x: 10, y: 20 },
        { x: 40, y: 60 },
      ]),
    ).toEqual({ distance: 50, midpoint: { x: 25, y: 40 } })
  })

  it("keeps the content under the gesture midpoint while zooming", () => {
    expect(offsetForPreviewZoom({ x: 20, y: 30 }, { x: 100, y: 150 }, 1, 2)).toEqual({
      x: -60,
      y: -90,
    })
  })

  it("supports zoom translations relative to a fixed center", () => {
    expect(
      offsetForPreviewZoom({ x: 10, y: 5 }, { x: 150, y: 80 }, 0.75, 1.5, { x: 100, y: 100 }),
    ).toEqual({ x: -30, y: 30 })
  })

  it("clamps configurable zoom ranges", () => {
    expect(clampZoom(0.25, 0.55, 1.8)).toBe(0.55)
    expect(clampZoom(3, 0.55, 1.8)).toBe(1.8)
  })
})
