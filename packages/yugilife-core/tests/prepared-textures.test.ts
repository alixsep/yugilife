import { describe, expect, it, vi } from "vitest"

import { collectTexturePreparations, preparedTextureKey } from "../src/prepared-textures"
import { createDefaultLayerRenderers } from "../src/rendering/default-renderers"

import { testTemplate } from "./fixtures"

import type { CardTemplate, ColorPresetCollection, RasterLayer } from "../src"

const linear: ColorPresetCollection = {
  "effect-box": {
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
  },
  frame: {
    method: "rgb-polynomial",
    exponents: [[0, 0, 0]],
    coefficients: [[1, 1, 1]],
  },
  plain: { method: "identity" },
}

function textureLayer(overrides: Partial<RasterLayer> = {}): RasterLayer {
  return {
    assetId: "texture",
    id: "frameTexture",
    kind: "raster",
    region: { height: 20, width: 20, x: 0, y: 0 },
    renderer: "color-texture",
    ...overrides,
  }
}

function template(overrides: Partial<CardTemplate>): CardTemplate {
  return testTemplate({ layers: [textureLayer()], ...overrides })
}

describe("texture preparation collection", () => {
  it("covers every preset a presentation rule can assign to a layer's target", () => {
    const preparations = collectTexturePreparations(
      template({
        layers: [textureLayer({ presetTarget: "frame" })],
        presentationRules: [
          { id: "spell", presets: { frame: "frame" }, when: { path: "kind", equals: "spell" } },
          { id: "trap", presets: { frame: "effect-box" }, when: { path: "kind", equals: "trap" } },
          { id: "other", presets: { unrelated: "frame" }, when: { path: "kind", equals: "trap" } },
        ],
      }),
      linear,
    )

    expect(preparations.map(({ presetName }) => presetName).sort()).toEqual(["effect-box", "frame"])
    expect(preparations.every(({ assetId }) => assetId === "texture")).toBe(true)
  })

  it("pairs every selectable asset with every reachable preset and keeps the source region", () => {
    const region = { height: 5, width: 10, x: 1, y: 2 }
    const preparations = collectTexturePreparations(
      template({
        layers: [textureLayer({ defaultPreset: "frame", sourceRegion: region })],
        presentationRules: [
          {
            id: "variant",
            assetSelections: { frameTexture: "variant-texture" },
            when: { path: "kind", equals: "spell" },
          },
        ],
      }),
      linear,
    )

    expect(preparations).toEqual([
      { assetId: "texture", presetName: "frame", region },
      { assetId: "variant-texture", presetName: "frame", region },
    ])
  })

  it("omits presets that do no pixel work and names the template does not define", () => {
    expect(
      collectTexturePreparations(
        template({ layers: [textureLayer({ defaultPreset: "plain" })] }),
        linear,
      ),
    ).toEqual([])
    expect(
      collectTexturePreparations(
        template({ layers: [textureLayer({ defaultPreset: "missing" })] }),
        linear,
      ),
    ).toEqual([])
  })

  it("prepares one texture when separate layers grade the same asset region alike", () => {
    const preparations = collectTexturePreparations(
      template({
        layers: [
          textureLayer({ defaultPreset: "frame" }),
          textureLayer({ defaultPreset: "frame", id: "pendulumFrameTexture" }),
        ],
      }),
      linear,
    )

    expect(preparations).toHaveLength(1)
  })

  it("separates the complete source image from an explicitly cropped region", () => {
    expect(preparedTextureKey({ assetId: "texture", presetName: "frame" })).not.toBe(
      preparedTextureKey({
        assetId: "texture",
        presetName: "frame",
        region: { height: 5, width: 10, x: 1, y: 2 },
      }),
    )
  })
})

describe("color-texture renderer with prepared textures", () => {
  function renderContext(preparedTextures: ReadonlyMap<string, CanvasImageSource>) {
    const drawImage = vi.fn()
    const resolve = vi.fn(() => {
      throw new Error("resolved the source asset")
    })
    return {
      drawImage,
      resolve,
      context: {
        assetSelections: {},
        assets: { has: () => true, resolve },
        colorPresets: linear,
        context: { drawImage } as unknown as CanvasRenderingContext2D,
        coverageContext: undefined,
        preparedTextures,
        presetOverrides: {},
      },
    }
  }

  function colorTextureRenderer() {
    const renderer = createDefaultLayerRenderers()["color-texture"]
    if (!renderer) throw new Error("The default color-texture renderer is missing.")
    return renderer
  }

  it("draws the prepared texture without resolving or grading the source asset", async () => {
    const prepared = { height: 20, width: 20 } as unknown as CanvasImageSource
    const key = preparedTextureKey({ assetId: "texture", presetName: "frame" })
    const { context, drawImage, resolve } = renderContext(new Map([[key, prepared]]))

    await colorTextureRenderer().render(context as never, textureLayer({ defaultPreset: "frame" }))

    expect(drawImage).toHaveBeenCalledWith(prepared, 0, 0, 20, 20)
    expect(resolve).not.toHaveBeenCalled()
  })

  it("keeps a differently cropped layer off another region's prepared texture", async () => {
    const prepared = { height: 20, width: 20 } as unknown as CanvasImageSource
    const key = preparedTextureKey({ assetId: "texture", presetName: "frame" })
    const { context, resolve } = renderContext(new Map([[key, prepared]]))

    await expect(
      colorTextureRenderer().render(
        context as never,
        textureLayer({
          defaultPreset: "frame",
          sourceRegion: { height: 5, width: 10, x: 1, y: 2 },
        }),
      ),
    ).rejects.toThrow("resolved the source asset")
    expect(resolve).toHaveBeenCalledWith("texture")
  })

  it("grades live when the resolved preset has no prepared texture", async () => {
    const { context, resolve } = renderContext(new Map())

    await expect(
      colorTextureRenderer().render(context as never, textureLayer({ defaultPreset: "frame" })),
    ).rejects.toThrow("resolved the source asset")
    expect(resolve).toHaveBeenCalledWith("texture")
  })
})
