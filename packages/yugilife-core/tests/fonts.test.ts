import { afterEach, describe, expect, it, vi } from "vitest"

import { MapAssetResolver, renderCard } from "../src"
import { loadTemplateFonts } from "../src/rendering/assets"

import { NAME_FIELD, testTemplateBundle } from "./fixtures"

const fontTemplate = {
  schemaVersion: 1,
  dimensions: { width: 100, height: 150 },
  cardFields: [NAME_FIELD],
  layers: [
    {
      id: "name",
      kind: "text" as const,
      field: "name",
      position: { x: 10, y: 20 },
      typography: {
        fill: "#000",
        fontAssetId: "font.test",
        fontFamily: "TestFont",
        fontSize: 20,
        maxWidth: 80,
      },
    },
  ],
}

function installFontSet() {
  const add = vi.fn()
  const fontSet = { add }
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: fontSet,
  })
  return { add, fontSet }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: undefined,
  })
})

describe("template font readiness", () => {
  it("fails instead of measuring fallback text when required font APIs are unavailable", async () => {
    installFontSet()
    vi.stubGlobal("FontFace", undefined)

    await expect(
      loadTemplateFonts(fontTemplate, new MapAssetResolver({ "font.test": "/missing-api.woff2" })),
    ).rejects.toThrow(/FontFace and document\.fonts support/)
  })

  it("does not measure text until every required font has loaded", async () => {
    const { add } = installFontSet()
    let finishFont!: () => void
    let fontReady = false
    class FakeFontFace {
      load() {
        return new Promise<this>((resolve) => {
          finishFont = () => {
            fontReady = true
            resolve(this)
          }
        })
      }
    }
    vi.stubGlobal("FontFace", FakeFontFace)
    const measureText = vi.fn(() => {
      expect(fontReady).toBe(true)
      return { width: 120 }
    })
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      measureText,
      restore() {},
      save() {},
    } as unknown as CanvasRenderingContext2D)

    const rendering = renderCard(
      { name: "Wait for the font" },
      {
        assets: { "font.test": "/font-order.woff2" },
        templateBundle: testTemplateBundle(fontTemplate),
      },
    )
    await Promise.resolve()
    expect(measureText).not.toHaveBeenCalled()
    finishFont()
    await rendering

    expect(add).toHaveBeenCalledOnce()
    expect(measureText).toHaveBeenCalled()
  })

  it("loads the font selected by resolved presentation overrides", async () => {
    installFontSet()
    const constructed: Array<[string, string]> = []
    class FakeFontFace {
      constructor(family: string, source: string) {
        constructed.push([family, source])
      }

      load() {
        return Promise.resolve(this)
      }
    }
    vi.stubGlobal("FontFace", FakeFontFace)
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      measureText: () => ({ width: 20 }),
      restore() {},
      save() {},
    } as unknown as CanvasRenderingContext2D)

    await renderCard(
      { name: "Override font" },
      {
        assets: {
          "font.override": "/override-font.woff2",
          "font.test": "/default-font.woff2",
        },
        presentationOverrides: {
          textTypography: {
            name: {
              default: {
                fontAssetId: "font.override",
                fontFamily: "OverrideFont",
              },
            },
          },
        },
        templateBundle: testTemplateBundle(fontTemplate),
      },
    )

    expect(constructed).toHaveLength(1)
    expect(constructed[0]?.[0]).toBe("OverrideFont")
    expect(constructed[0]?.[1]).toContain("override-font.woff2")
  })

  it("evicts rejected font loads so the same source can retry", async () => {
    installFontSet()
    let attempts = 0
    class FakeFontFace {
      load() {
        attempts += 1
        return attempts === 1 ? Promise.reject(new Error("font failed")) : Promise.resolve(this)
      }
    }
    vi.stubGlobal("FontFace", FakeFontFace)
    const resolver = new MapAssetResolver({ "font.test": "/retry-font.woff2" })

    await expect(loadTemplateFonts(fontTemplate, resolver)).rejects.toThrow("font failed")
    await expect(loadTemplateFonts(fontTemplate, resolver)).resolves.toBeUndefined()
    expect(attempts).toBe(2)
  })

  it("aborts one font consumer without cancelling another consumer's shared load", async () => {
    const { add } = installFontSet()
    let finishFont!: () => void
    let instances = 0
    class FakeFontFace {
      constructor() {
        instances += 1
      }

      load() {
        return new Promise<this>((resolve) => {
          finishFont = () => resolve(this)
        })
      }
    }
    vi.stubGlobal("FontFace", FakeFontFace)
    const resolver = new MapAssetResolver({ "font.test": "/shared-font.woff2" })
    const controller = new AbortController()
    const aborted = loadTemplateFonts(fontTemplate, resolver, controller.signal)
    const continuing = loadTemplateFonts(fontTemplate, resolver)

    controller.abort()
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" })
    finishFont()
    await expect(continuing).resolves.toBeUndefined()
    expect(instances).toBe(1)
    expect(add).toHaveBeenCalledOnce()
  })

  it("rejects conflicting assets assigned to one font family", async () => {
    installFontSet()
    vi.stubGlobal(
      "FontFace",
      class {
        load() {
          return Promise.resolve(this)
        }
      },
    )
    const baseFontLayer = fontTemplate.layers[0]
    if (!baseFontLayer) throw new Error("Font test fixture requires a text layer.")
    const conflictingTemplate = {
      ...fontTemplate,
      layers: [
        baseFontLayer,
        {
          ...baseFontLayer,
          id: "other-name",
          typography: {
            ...baseFontLayer.typography,
            fontAssetId: "font.other",
          },
        },
      ],
    }

    await expect(
      loadTemplateFonts(
        conflictingTemplate,
        new MapAssetResolver({
          "font.other": "/other.woff2",
          "font.test": "/test.woff2",
        }),
      ),
    ).rejects.toThrow(/maps to both "font\.test" and "font\.other"/)
  })
})
