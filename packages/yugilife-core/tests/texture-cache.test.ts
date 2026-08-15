import { afterEach, describe, expect, it, vi } from "vitest"

import { TextureCache } from "../src/color-grading"
import { texturePresetKey } from "../src/rendering/default-renderers"

const source = {
  complete: true,
  height: 10,
  width: 10,
} as CanvasImageSource & { complete: boolean; height: number; width: number }

function context(drawImage = vi.fn()) {
  return {
    drawImage,
    getImageData: () => ({ data: new Uint8ClampedArray(10 * 10 * 4) }),
    putImageData() {},
  } as unknown as CanvasRenderingContext2D
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("texture cache correctness", () => {
  it("changes the cache key when a preset is replaced or mutated in place", () => {
    const preset = {
      method: "rgb-polynomial",
      exponents: [[0, 0, 0]],
      coefficients: [[1, 1, 1]],
    }
    const original = texturePresetKey("frame", preset)
    preset.coefficients[0]![0] = 0

    expect(texturePresetKey("frame", preset)).not.toBe(original)
    expect(
      texturePresetKey("frame", {
        method: "rgb-polynomial",
        exponents: [[0, 0, 0]],
        coefficients: [[0, 1, 1]],
      }),
    ).toBe(texturePresetKey("frame", preset))
  })

  it("does not cache a failed texture computation", () => {
    let attempts = 0
    const drawImage = vi.fn(() => {
      attempts += 1
      if (attempts === 1) throw new Error("draw failed")
    })
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context(drawImage))
    const cache = new TextureCache(source)

    expect(() => cache.get("identity", { method: "identity" })).toThrow("draw failed")
    expect(cache.get("identity", { method: "identity" })).toBeInstanceOf(HTMLCanvasElement)
    expect(attempts).toBe(2)
  })

  it("retains the exact CPU path when OffscreenCanvas acceleration is unavailable", () => {
    vi.stubGlobal("OffscreenCanvas", undefined)
    const largeSource = {
      complete: true,
      height: 300,
      width: 300,
    } as CanvasImageSource & { complete: boolean; height: number; width: number }
    const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(300 * 300 * 4) }))
    const putImageData = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      getImageData,
      putImageData,
    } as unknown as CanvasRenderingContext2D)

    const cache = new TextureCache(largeSource)
    expect(
      cache.get("linear", {
        method: "rgb-polynomial",
        exponents: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
        coefficients: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
      }),
    ).toBeInstanceOf(HTMLCanvasElement)
    expect(getImageData).toHaveBeenCalledOnce()
    expect(putImageData).toHaveBeenCalledOnce()
  })

  it("evicts least-recently-used canvases at its configured memory bound", () => {
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(context())
    const cache = new TextureCache(source, 2)
    const preset = { method: "identity" as const }

    cache.get("first", preset)
    cache.get("second", preset)
    cache.get("third", preset)
    expect(getContext).toHaveBeenCalledTimes(3)

    cache.get("first", preset)
    expect(getContext).toHaveBeenCalledTimes(4)
  })
})
