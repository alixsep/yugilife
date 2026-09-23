import { describe, expect, it } from "vitest"

import { resolveCardPresentation, validateCardTemplate } from "../src"
import { createTextElement } from "../src/rendering/vector"
import { deriveCardSemantics } from "../src/semantics"

import { testTemplate } from "./fixtures"

import type { CardTemplate, TextLayer } from "../src"

const ARTWORK_FIELD = {
  kind: "image" as const,
  label: "Artwork",
  name: "artwork",
}

function paintTemplate(overrides: Partial<CardTemplate> = {}): CardTemplate {
  return testTemplate({
    cardFields: [
      { defaultValue: "Test card", kind: "text", label: "Name", name: "name", required: true },
      ARTWORK_FIELD,
    ],
    layers: [
      {
        id: "artwork",
        kind: "artwork",
        field: "artwork",
        region: { x: 0, y: 0, width: 100, height: 100 },
      },
      {
        id: "title",
        kind: "text",
        field: "name",
        position: { x: 10, y: 20 },
        typography: { fill: "#111111", fontFamily: "Test", fontSize: 20 },
      },
    ],
    ...overrides,
  })
}

const card = { artwork: "", name: "Test card" }

function resolve(template: CardTemplate, mode?: string) {
  const validated = validateCardTemplate(template)
  return resolveCardPresentation(
    validated,
    deriveCardSemantics(card, validated),
    mode === undefined
      ? undefined
      : { artworkTransforms: { artwork: { mode, scale: 1, x: 0, y: 0 } } },
  )
}

/** Adds a transform-gated style to the title layer of the fixture above. */
function withGatedStyle(gate: Record<string, string | null>, id = "gated") {
  const template = paintTemplate()
  const layers = [...template.layers]
  const title = { ...(layers[1] as TextLayer) }
  title.semanticStyles = [
    {
      id,
      label: "Gated title",
      whenTransforms: gate,
      typography: {
        fill: "#ffffff",
        stroke: { color: "#000000", width: 3 },
      },
    },
  ]
  layers[1] = title
  return { ...template, layers }
}

describe("transform-mode presentation gate", () => {
  it("selects a style only while the transform carries the declared mode", () => {
    const template = withGatedStyle({ artwork: "full-art" })

    expect(resolve(template).text["title"]?.styleId).toBe("default")
    expect(resolve(template, "full-art").text["title"]?.styleId).toBe("gated")
    expect(resolve(template, "other").text["title"]?.styleId).toBe("default")
  })

  it("matches a null gate only when the transform carries no mode at all", () => {
    const template = withGatedStyle({ artwork: null })

    expect(resolve(template).text["title"]?.styleId).toBe("gated")
    expect(resolve(template, "full-art").text["title"]?.styleId).toBe("default")
  })

  it("requires the semantic clause and the transform clause to match together", () => {
    const base = withGatedStyle({ artwork: "full-art" })
    const layers = [...base.layers]
    const title = { ...(layers[1] as TextLayer) }
    title.semanticStyles = [
      {
        ...title.semanticStyles![0]!,
        when: { path: "gate.on", equals: true },
      },
    ]
    layers[1] = title
    const template = {
      ...base,
      layers,
      semanticBindings: { bindings: [{ path: "gate.on", source: { value: false } }] },
    } as CardTemplate

    // The semantic clause is false, so a matching mode alone must not activate the style.
    expect(resolve(template, "full-art").text["title"]?.styleId).toBe("default")
  })

  it("rejects a gate referencing an artwork transform the template never declares", () => {
    expect(() => validateCardTemplate(withGatedStyle({ nope: "full-art" }))).toThrow(
      /unknown artwork transform "nope"/u,
    )
  })

  it("rejects a style that declares neither a semantic nor a transform clause", () => {
    const template = paintTemplate()
    const layers = [...template.layers]
    layers[1] = {
      ...(layers[1] as TextLayer),
      semanticStyles: [{ id: "empty", label: "Empty", typography: { fill: "#fff" } }],
    }
    expect(() => validateCardTemplate({ ...template, layers })).toThrow(
      /must declare when or whenTransforms/u,
    )
  })
})

describe("text stroke", () => {
  const strokeTypography = {
    fill: "#ffffff",
    fontFamily: "Test",
    fontSize: 20,
    stroke: { color: "#000000", width: 3 },
  }

  function layout(typography: TextLayer["typography"]) {
    const layer: TextLayer = {
      id: "title",
      kind: "text",
      field: "name",
      position: { x: 10, y: 20 },
      typography,
    }
    return createTextElement(card, layer, (text) => text.length * 4)
  }

  it("paints an outer stroke under the fill at double the authored width", () => {
    const element = layout(strokeTypography)

    // SVG strokes straddle the outline, so an outer stroke of 3 is a centred stroke of 6 painted
    // first; anything else would visibly thin the glyphs.
    expect(element.attributes?.["stroke"]).toBe("#000000")
    expect(element.attributes?.["stroke-width"]).toBe(6)
    expect(element.attributes?.["paint-order"]).toBe("stroke fill")
  })

  it("keeps a centred stroke at its authored width and SVG's own paint order", () => {
    const element = layout({
      ...strokeTypography,
      stroke: { color: "#000", width: 3, align: "center" },
    })

    expect(element.attributes?.["stroke-width"]).toBe(3)
    expect(element.attributes?.["paint-order"]).toBe("fill stroke")
  })

  it("emits no stroke attributes when the typography declares none", () => {
    const element = layout({ fill: "#111111", fontFamily: "Test", fontSize: 20 })

    expect(element.attributes?.["stroke"]).toBeUndefined()
    expect(element.attributes?.["paint-order"]).toBeUndefined()
  })

  it("is painted, never measured, so it cannot change the fitted layout", () => {
    const plain = layout({ fill: "#111111", fontFamily: "Test", fontSize: 20, maxWidth: 30 })
    const stroked = layout({
      fill: "#111111",
      fontFamily: "Test",
      fontSize: 20,
      maxWidth: 30,
      stroke: { color: "#000000", width: 12 },
    })

    expect(stroked.attributes?.["font-size"]).toBe(plain.attributes?.["font-size"])
    expect(stroked.text).toBe(plain.text)
    expect(stroked.children).toEqual(plain.children)
  })

  it("rejects malformed stroke values at the template boundary", () => {
    const withStroke = (stroke: unknown) => {
      const template = paintTemplate()
      const layers = [...template.layers]
      layers[1] = {
        ...(layers[1] as TextLayer),
        typography: { ...strokeTypography, stroke } as never,
      }
      return () => validateCardTemplate({ ...template, layers })
    }

    expect(withStroke({ color: "#000", width: 0 })).toThrow(/width/u)
    expect(withStroke({ color: "", width: 2 })).toThrow(/color/u)
    expect(withStroke({ color: "#000", width: 2, align: "inner" })).toThrow(/align/u)
    expect(withStroke({ color: "#000", width: 2, opacity: 2 })).toThrow(/opacity/u)
    expect(withStroke({ color: "#000", width: 2, glow: 3 })).toThrow(/glow/u)
  })
})
