import { afterEach, describe, expect, it, vi } from "vitest"

import { createRenderManifest } from "../src/rendering/render-manifest"

import { testTemplate } from "./fixtures"

function alphaCanvas(alpha: readonly number[], width: number, height: number) {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const data = new Uint8ClampedArray(width * height * 4)
  alpha.forEach((value, pixel) => {
    data[pixel * 4 + 3] = value
  })
  const context = {
    getImageData: vi.fn(() => ({ data })),
  } as unknown as CanvasRenderingContext2D
  vi.spyOn(canvas, "getContext").mockReturnValue(context)
  return canvas
}

afterEach(() => vi.restoreAllMocks())

describe("render manifest", () => {
  it("retains exact final-visible alpha and tight bounds after overlapping layers coalesce", async () => {
    const template = testTemplate({ dimensions: { height: 1, width: 2 } })
    const manifest = await createRenderManifest(
      [
        {
          canvas: alphaCanvas([255, 128], 2, 1),
          kind: "image",
          layerId: "bottom",
          order: 0,
          sourceFields: ["name"],
        },
        {
          canvas: alphaCanvas([255, 0], 2, 1),
          kind: "image",
          layerId: "top",
          order: 1,
          sourceFields: [],
        },
      ],
      template,
      (elements) => Promise.resolve(elements),
    )

    expect(manifest.elements.map(({ layerId }) => layerId)).toEqual(["bottom", "top"])
    const bottom = manifest.elements[0]
    const top = manifest.elements[1]
    expect(bottom?.bounds).toEqual({ height: 1, width: 1, x: 1, y: 0 })
    expect(bottom?.alpha.alphaAt(0, 0)).toBe(0)
    expect(bottom?.alpha.alphaAt(1, 0)).toBe(128)
    expect(bottom?.absoluteBounds).toEqual({ height: 1, width: 2, x: 0, y: 0 })
    expect(bottom?.absoluteAlpha.alphaAt(0, 0)).toBe(255)
    expect(bottom?.absoluteAlpha.alphaAt(1, 0)).toBe(128)
    expect(top?.bounds).toEqual({ height: 1, width: 1, x: 0, y: 0 })
    expect(top?.alpha.alphaAt(0, 0)).toBe(255)
    expect(top?.alpha.alphaAt(1, 0)).toBe(0)
  })

  it("accounts for partial alpha from every higher layer", async () => {
    const template = testTemplate({ dimensions: { height: 1, width: 1 } })
    const manifest = await createRenderManifest(
      [
        {
          canvas: alphaCanvas([255], 1, 1),
          kind: "image",
          layerId: "bottom",
          order: 0,
          sourceFields: [],
        },
        {
          canvas: alphaCanvas([128], 1, 1),
          kind: "image",
          layerId: "middle",
          order: 1,
          sourceFields: [],
        },
        {
          canvas: alphaCanvas([128], 1, 1),
          kind: "image",
          layerId: "top",
          order: 2,
          sourceFields: [],
        },
      ],
      template,
      (elements) => Promise.resolve(elements),
    )

    expect(manifest.elements.map(({ alpha }) => alpha.alphaAt(0, 0))).toEqual([63, 64, 128])
  })

  it("retains fully occluded layers with empty final-visible coverage", async () => {
    const template = testTemplate({ dimensions: { height: 1, width: 1 } })
    const manifest = await createRenderManifest(
      [
        {
          canvas: alphaCanvas([255], 1, 1),
          kind: "image",
          layerId: "bottom",
          order: 0,
          sourceFields: ["name"],
        },
        {
          canvas: alphaCanvas([255], 1, 1),
          kind: "image",
          layerId: "top",
          order: 1,
          sourceFields: [],
        },
      ],
      template,
      (elements) => Promise.resolve(elements),
    )

    expect(manifest.elements.map(({ layerId }) => layerId)).toEqual(["bottom", "top"])
    expect(manifest.elements[0]?.bounds).toBeUndefined()
    expect(manifest.elements[0]?.alpha.alphaAt(0, 0)).toBe(0)
    expect(manifest.elements[0]?.absoluteBounds).toEqual({ height: 1, width: 1, x: 0, y: 0 })
    expect(manifest.elements[0]?.absoluteAlpha.alphaAt(0, 0)).toBe(255)
  })
})
