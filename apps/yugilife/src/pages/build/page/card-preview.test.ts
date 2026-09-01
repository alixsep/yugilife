import { describe, expect, it, vi } from "vitest"

import { renderedTextBounds, renderedTextFieldAt } from "./card-preview-hit-test"

describe("card preview text selection", () => {
  it("selects the highest browser-computed SVG text box", () => {
    const root = document.createElement("div")
    root.innerHTML = '<div role="img"><svg><g></g><g></g></svg></div>'
    const [description, name] = root.querySelectorAll<SVGGraphicsElement>("g")
    vi.spyOn(description!, "getBoundingClientRect").mockReturnValue({
      bottom: 10,
      height: 10,
      left: 0,
      right: 10,
      top: 0,
      width: 10,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    vi.spyOn(name!, "getBoundingClientRect").mockReturnValue({
      bottom: 10,
      height: 10,
      left: 0,
      right: 10,
      top: 0,
      width: 10,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    const fields = [
      { elementIndex: 0, field: "description", segmentIndex: 0 },
      { controlIndex: 1, elementIndex: 1, field: "name", segmentIndex: 0 },
    ]
    expect(renderedTextFieldAt(root, fields, 5, 5)).toMatchObject({
      controlIndex: 1,
      field: "name",
    })
    expect(renderedTextFieldAt(root, fields, 20, 20)).toBeUndefined()
  })

  it("converts browser text rectangles into native card coordinates", () => {
    const root = document.createElement("div")
    root.innerHTML = '<div role="img"><svg><g></g></svg></div>'
    const text = root.querySelector<SVGGraphicsElement>("g")!
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      bottom: 250,
      height: 200,
      left: 100,
      right: 200,
      top: 50,
      width: 100,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    })
    vi.spyOn(text, "getBoundingClientRect").mockReturnValue({
      bottom: 110,
      height: 40,
      left: 125,
      right: 175,
      top: 70,
      width: 50,
      x: 125,
      y: 70,
      toJSON: () => ({}),
    })

    expect(
      renderedTextBounds(root, [{ elementIndex: 0, field: "name", segmentIndex: 0 }], 800, 1200),
    ).toEqual([{ field: "name", region: { height: 240, width: 400, x: 200, y: 120 } }])
  })
})
