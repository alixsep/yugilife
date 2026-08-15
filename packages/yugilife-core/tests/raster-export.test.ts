import { afterEach, describe, expect, it, vi } from "vitest"

import { renderCard, resolveRasterOutputDimensions } from "../src"

import { NAME_FIELD } from "./fixtures"

import type { RasterOutputSize } from "../src"

class LoadedImage {
  private readonly listeners = new Map<string, () => void>()

  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener)
  }

  set src(value: string) {
    if (value) queueMicrotask(() => this.listeners.get("load")?.())
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("raster image export", () => {
  it("rasterizes the complete rendered card to a scaled PNG Blob", async () => {
    const drawImage = vi.fn()
    const fillRect = vi.fn()
    vi.stubGlobal("Image", LoadedImage)
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:rendered-card")
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
    const context = {
      drawImage,
      fillRect,
      fillStyle: "",
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
    }
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    )
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation((callback) => {
        callback(new Blob(["png"], { type: "image/png" }))
      })

    const rendered = await renderCard(
      { name: "PNG" },
      {
        templateBundle: {
          assets: {},
          colorPresets: {},
          manifest: {
            assets: {},
            id: "card/png-test",
            kind: "card",
            name: "PNG test",
            template: "template.json",
            version: "2026.01.01",
          },
          template: {
            cardFields: [NAME_FIELD],
            dimensions: { height: 150, width: 100 },
            layers: [],
            schemaVersion: 1,
          },
        },
      },
    )
    const png = await rendered.toPng({ scale: 2 })

    expect(png.type).toBe("image/png")
    expect(drawImage).toHaveBeenCalledWith(expect.any(LoadedImage), 0, 0, 200, 300)
    expect(fillRect).not.toHaveBeenCalled()
    expect(context.imageSmoothingEnabled).toBe(true)
    expect(context.imageSmoothingQuality).toBe("high")
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png", undefined)
    expect(revoke).toHaveBeenCalledWith("blob:rendered-card")
  })

  it("encodes JPEG with an explicit matte, output width, and quality", async () => {
    const drawImage = vi.fn()
    const fillRect = vi.fn()
    const context = { drawImage, fillRect, fillStyle: "" }
    vi.stubGlobal("Image", LoadedImage)
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:rendered-card")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    )
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation((callback) => {
        callback(new Blob(["jpeg"], { type: "image/jpeg" }))
      })
    const rendered = await renderCard(
      { name: "JPEG" },
      {
        templateBundle: {
          assets: {},
          colorPresets: {},
          manifest: {
            assets: {},
            id: "card/jpeg-test",
            kind: "card",
            name: "JPEG test",
            template: "template.json",
            version: "2026.01.01",
          },
          template: {
            cardFields: [NAME_FIELD],
            dimensions: { height: 150, width: 100 },
            layers: [],
            schemaVersion: 1,
          },
        },
      },
    )

    const jpeg = await rendered.toImage({
      backgroundColor: "#abc",
      format: "jpeg",
      quality: 0.8,
      size: { width: 250 },
    })

    expect(jpeg.type).toBe("image/jpeg")
    expect(context.fillStyle).toBe("#abc")
    expect(fillRect).toHaveBeenCalledWith(0, 0, 250, 375)
    expect(drawImage).toHaveBeenCalledWith(expect.any(LoadedImage), 0, 0, 250, 375)
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.8)
  })

  it("rasterizes below-native output at native size before high-quality downsampling", async () => {
    const drawImage = vi.fn()
    const context = {
      drawImage,
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
    }
    vi.stubGlobal("Image", LoadedImage)
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:rendered-card")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    )
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["png"], { type: "image/png" }))
    })
    const rendered = await renderCard(
      { name: "Downsampled PNG" },
      {
        templateBundle: {
          assets: {},
          colorPresets: {},
          manifest: {
            assets: {},
            id: "card/downsample-test",
            kind: "card",
            name: "Downsample test",
            template: "template.json",
            version: "2026.01.01",
          },
          template: {
            cardFields: [NAME_FIELD],
            dimensions: { height: 150, width: 100 },
            layers: [],
            schemaVersion: 1,
          },
        },
      },
    )

    await rendered.toPng({ scale: 0.5 })

    expect(drawImage).toHaveBeenNthCalledWith(1, expect.any(LoadedImage), 0, 0, 100, 150)
    expect(drawImage).toHaveBeenNthCalledWith(2, expect.any(HTMLCanvasElement), 0, 0, 50, 75)
    expect(context.imageSmoothingEnabled).toBe(true)
    expect(context.imageSmoothingQuality).toBe("high")
  })

  it("rejects unsupported encoder fallback instead of returning mislabeled output", async () => {
    vi.stubGlobal("Image", LoadedImage)
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:rendered-card")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["fallback"], { type: "image/png" }))
    })
    const rendered = await renderCard(
      { name: "WebP" },
      {
        templateBundle: {
          assets: {},
          colorPresets: {},
          manifest: {
            assets: {},
            id: "card/webp-test",
            kind: "card",
            name: "WebP test",
            template: "template.json",
            version: "2026.01.01",
          },
          template: {
            cardFields: [NAME_FIELD],
            dimensions: { height: 150, width: 100 },
            layers: [],
            schemaVersion: 1,
          },
        },
      },
    )

    await expect(rendered.toImage({ format: "webp" })).rejects.toThrow(/does not support WEBP/)
    await expect(rendered.toImage({ format: "toString" as "webp" })).rejects.toThrow(
      /Unsupported raster image format/,
    )
  })

  it("rejects invalid output scales before image loading", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as CanvasRenderingContext2D,
    )
    const rendered = await renderCard(
      { name: "PNG" },
      {
        templateBundle: {
          assets: {},
          colorPresets: {},
          manifest: {
            assets: {},
            id: "card/png-test",
            kind: "card",
            name: "PNG test",
            template: "template.json",
            version: "2026.01.01",
          },
          template: {
            cardFields: [NAME_FIELD],
            dimensions: { height: 150, width: 100 },
            layers: [],
            schemaVersion: 1,
          },
        },
      },
    )

    await expect(rendered.toPng({ scale: 0 })).rejects.toThrow(/greater than zero/)
  })

  it("resolves aspect-preserving width, height, and scale sizes within the output budget", () => {
    expect(resolveRasterOutputDimensions({ height: 1185, width: 813 })).toEqual({
      height: 1185,
      width: 813,
    })
    expect(resolveRasterOutputDimensions({ height: 1185, width: 813 }, { width: 1200 })).toEqual({
      height: 1749,
      width: 1200,
    })
    expect(resolveRasterOutputDimensions({ height: 1185, width: 813 }, { height: 600 })).toEqual({
      height: 600,
      width: 412,
    })
    expect(resolveRasterOutputDimensions({ height: 1185, width: 813 }, { scale: 2 })).toEqual({
      height: 2370,
      width: 1626,
    })
    expect(() => resolveRasterOutputDimensions({ height: 1185, width: 813 }, { scale: 9 })).toThrow(
      /64000000/,
    )
    expect(resolveRasterOutputDimensions({ height: 150.4, width: 100.4 })).toEqual({
      height: 150,
      width: 100,
    })
    expect(() =>
      resolveRasterOutputDimensions({ height: 1185, width: 813 }, {
        scale: 2,
        width: 100,
      } as RasterOutputSize),
    ).toThrow(/exactly one/)
  })
})
