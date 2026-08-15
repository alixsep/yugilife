import { describe, expect, it } from "vitest"

import { offsetForPreviewZoom, previewPinchGesture } from "./preview-viewport"

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
})
