import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { renderCard } from "../src"

import { NAME_FIELD, testTemplate, testTemplateBundle } from "./fixtures"

import type { CardTemplate, ImageLayer, RenderSegment } from "../src"
import type { LayerRenderer } from "../src/contracts"

const rasterRenderer: LayerRenderer = {
  output: "raster",
  render() {
    return true
  },
}

function textLayer(id: string) {
  return {
    field: "name",
    id,
    kind: "text",
    position: { x: 1, y: 2 },
    typography: { fill: "#000", fontFamily: "Test", fontSize: 10 },
  } as const
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: () => ({ width: 10 }),
    restore() {},
    save() {},
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/png;base64,cmFzdGVy",
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function render(template: CardTemplate) {
  return await renderCard(
    { name: "Ordered text" },
    {
      layerRenderers: { "test-raster": rasterRenderer },
      templateBundle: testTemplateBundle(template),
    },
  )
}

describe("ordered render segments", () => {
  it("applies semantic frame presentation before explicit render overrides", async () => {
    const observations: { id: string; frame: string | undefined; visible: boolean }[] = []
    const rendered = await renderCard(
      { linkRating: 1, monsterFrame: "link", name: "Link card" },
      {
        layers: { frameTexture: true },
        presetOverrides: { frame: "manual-frame" },
        layerRenderers: {
          observed: {
            output: "vector",
            render({ layerVisibility, presetOverrides }, layer) {
              observations.push({
                frame: presetOverrides.frame,
                id: layer.id,
                visible: layerVisibility[layer.id] ?? false,
              })
            },
          },
        },
        templateBundle: testTemplateBundle(
          testTemplate({
            cardFields: [
              NAME_FIELD,
              {
                defaultValue: "link",
                kind: "text",
                label: "Monster frame",
                name: "monsterFrame",
                options: ["link"],
                required: true,
              },
              { kind: "number", label: "Link rating", max: 8, min: 1, name: "linkRating" },
            ],
            layers: [
              { defaultVisible: false, id: "frameTexture", kind: "observed" },
              { defaultVisible: false, id: "linkFrame", kind: "observed" },
            ],
            presentationRules: [
              {
                id: "link-frame",
                layerVisibility: { frameTexture: false, linkFrame: true },
                presets: { frame: "automatic-frame" },
                when: { equals: "link", path: "monster.frame" },
              },
            ],
            semanticBindings: {
              bindings: [
                { path: "kind", source: { value: "monster" } },
                { path: "monster.frame", source: { field: "monsterFrame" } },
              ],
            },
          }),
        ),
      },
    )

    expect(rendered.presentation.presets).toStrictEqual({ frame: "automatic-frame" })
    expect(observations).toStrictEqual([
      { frame: "manual-frame", id: "frameTexture", visible: true },
      { frame: "manual-frame", id: "linkFrame", visible: true },
    ])
  })

  it("passes declarative layer asset selections to renderers", async () => {
    const observations: string[] = []
    await renderCard(
      { monsterFrame: "xyz", name: "XYZ card" },
      {
        assets: { "base.asset": "base", "selected.asset": "selected" },
        layerRenderers: {
          image: {
            output: "vector",
            render({ assetSelections }, layer) {
              observations.push(assetSelections[layer.id] ?? "layer-default")
            },
          },
        },
        templateBundle: testTemplateBundle(
          testTemplate({
            cardFields: [
              NAME_FIELD,
              {
                defaultValue: "xyz",
                kind: "text",
                label: "Monster frame",
                name: "monsterFrame",
                options: ["xyz"],
                required: true,
              },
            ],
            layers: [
              {
                assetId: "base.asset",
                id: "frameTexture",
                kind: "image",
                region: { height: 10, width: 10, x: 0, y: 0 },
              },
            ],
            presentationRules: [
              {
                assetSelections: { frameTexture: "selected.asset" },
                id: "xyz-frame",
                when: { equals: "xyz", path: "monster.frame" },
              },
            ],
            semanticBindings: {
              bindings: [{ path: "monster.frame", source: { field: "monsterFrame" } }],
            },
          }),
        ),
      },
    )

    expect(observations).toStrictEqual(["selected.asset"])
  })

  it("passes semantic region selections to region-bearing layer renderers", async () => {
    const observations: { height: number; width: number; x: number; y: number }[] = []
    const imageRenderer: LayerRenderer<ImageLayer> = {
      output: "vector",
      render(_context, layer) {
        observations.push(layer.region)
      },
    }
    await renderCard(
      { monsterFrame: "xyz", name: "XYZ card" },
      {
        assets: { "marker.asset": "marker" },
        layerRenderers: {
          image: imageRenderer,
        },
        templateBundle: testTemplateBundle(
          testTemplate({
            schemaVersion: 1,
            cardFields: [
              NAME_FIELD,
              {
                defaultValue: "xyz",
                kind: "text",
                label: "Monster frame",
                name: "monsterFrame",
                options: ["xyz"],
                required: true,
              },
            ],
            layers: [
              {
                assetId: "marker.asset",
                id: "marker",
                kind: "image",
                region: { height: 10, width: 10, x: 0, y: 0 },
              },
            ],
            presentationRules: [
              {
                id: "xyz-marker-region",
                layerRegions: { marker: { height: 20, width: 30, x: 4, y: 5 } },
                when: { equals: "xyz", path: "monster.frame" },
              },
            ],
            semanticBindings: {
              bindings: [{ path: "monster.frame", source: { field: "monsterFrame" } }],
            },
          }),
        ),
      },
    )

    expect(observations).toStrictEqual([{ height: 20, width: 30, x: 4, y: 5 }])
  })

  it("preserves raster → text → raster order in render segments and SVG export", async () => {
    const rendered = await render(
      testTemplate({
        cardFields: [NAME_FIELD],
        layers: [
          { id: "before", kind: "test-raster" },
          textLayer("middle"),
          { id: "after", kind: "test-raster" },
        ],
      }),
    )

    expect(rendered.renderSegments.map((segment) => segment.kind)).toEqual([
      "raster",
      "vector",
      "raster",
    ])
    const svg = await rendered.toSvg({ textMode: "text" })
    const firstImage = svg.indexOf("<image ")
    const text = svg.indexOf("<text ")
    const secondImage = svg.indexOf("<image ", firstImage + 1)
    expect(firstImage).toBeGreaterThan(-1)
    expect(firstImage).toBeLessThan(text)
    expect(text).toBeLessThan(secondImage)
  })

  it("preserves SVG → raster → text order in render segments and SVG export", async () => {
    const rendered = await render(
      testTemplate({
        cardFields: [NAME_FIELD],
        layers: [
          { element: { attributes: { id: "vector-first" }, tag: "g" }, id: "svg", kind: "svg" },
          { id: "middle", kind: "test-raster" },
          textLayer("text"),
        ],
      }),
    )

    expect(rendered.renderSegments.map((segment) => segment.kind)).toEqual([
      "vector",
      "raster",
      "vector",
    ])
    const svg = await rendered.toSvg({ textMode: "text" })
    expect(svg.indexOf('id="vector-first"')).toBeLessThan(svg.indexOf("<image "))
    expect(svg.indexOf("<image ")).toBeLessThan(svg.indexOf("<text "))
  })

  it("rejects vector output from a renderer declared as raster", async () => {
    await expect(
      renderCard(
        { name: "Mixed" },
        {
          layerRenderers: {
            mixed: {
              output: "raster",
              render({ vectorLayers }) {
                vectorLayers.push({ tag: "text", text: "not raster" })
              },
            },
          },
          templateBundle: testTemplateBundle(
            testTemplate({ layers: [{ id: "mixed", kind: "mixed" }] }),
          ),
        },
      ),
    ).rejects.toThrow(/Split mixed output into separate ordered layers/)
  })

  it("requires custom renderers to declare one supported output plane", async () => {
    await expect(
      renderCard(
        { name: "Missing plane" },
        {
          layerRenderers: {
            missing: { render() {} } as unknown as LayerRenderer,
          },
          templateBundle: testTemplateBundle(
            testTemplate({ layers: [{ id: "missing", kind: "missing" }] }),
          ),
        },
      ),
    ).rejects.toThrow(/must declare output as "raster", "vector", or "container"/)
  })

  it("removes empty planes and coalesces consecutive compatible output", async () => {
    const rendered = await renderCard(
      { name: "Coalesced" },
      {
        layerRenderers: {
          "empty-vector": { output: "vector", render() {} },
          "test-raster": rasterRenderer,
        },
        templateBundle: testTemplateBundle(
          testTemplate({
            layers: [
              { id: "raster-a", kind: "test-raster" },
              { id: "empty-vector", kind: "empty-vector" },
              { id: "empty-group", kind: "group", layers: [] },
              { id: "raster-b", kind: "test-raster" },
              textLayer("text-a"),
              textLayer("text-b"),
            ],
          }),
        ),
      },
    )

    expect(rendered.renderSegments.map((segment) => segment.kind)).toEqual(["raster", "vector"])
    expect(rendered.renderSegments[1]).toMatchObject({
      elements: [{ tag: "text" }, { tag: "text" }],
    })
  })

  it("allows an unmasked group to emit vector output", async () => {
    const rendered = await renderCard(
      { name: "Vector group" },
      {
        layerRenderers: {
          "test-vector": {
            output: "vector",
            render({ vectorLayers }) {
              vectorLayers.push({ attributes: { id: "vector-child" }, tag: "g" })
            },
          },
        },
        templateBundle: testTemplateBundle(
          testTemplate({
            layers: [
              {
                id: "vector-group",
                kind: "group",
                layers: [{ id: "vector-child", kind: "test-vector" }],
              },
            ],
          }),
        ),
      },
    )

    expect(rendered.renderSegments.map((segment) => segment.kind)).toEqual(["vector"])
  })

  it("does not emit a raster segment when a raster renderer reports no output", async () => {
    const rendered = await renderCard(
      { name: "No raster" },
      {
        layerRenderers: {
          "empty-raster": { output: "raster", render: () => false },
        },
        templateBundle: testTemplateBundle(
          testTemplate({
            layers: [{ id: "empty-raster", kind: "empty-raster" }, textLayer("text")],
          }),
        ),
      },
    )

    expect(rendered.renderSegments.map((segment) => segment.kind)).toEqual(["vector"])
  })

  it("does not emit a raster segment for missing artwork handled by the core renderer", async () => {
    const rendered = await renderCard(
      { name: "No artwork" },
      {
        templateBundle: testTemplateBundle(
          testTemplate({
            cardFields: [NAME_FIELD, { kind: "image", label: "Artwork", name: "artwork" }],
            layers: [
              {
                field: "artwork",
                id: "artwork",
                kind: "artwork",
                region: { height: 10, width: 10, x: 0, y: 0 },
              },
            ],
          }),
        ),
      },
    )

    expect(rendered.renderSegments).toEqual([])
  })

  it("returns frozen segment and vector collections", async () => {
    const rendered = await render(
      testTemplate({
        layers: [{ id: "raster", kind: "test-raster" }, textLayer("text")],
      }),
    )
    const vectorSegment = rendered.renderSegments.find((segment) => segment.kind === "vector")

    expect(Object.isFrozen(rendered.renderSegments)).toBe(true)
    expect(rendered.renderSegments.every(Object.isFrozen)).toBe(true)
    expect(Object.isFrozen(rendered.vectorLayers)).toBe(true)
    expect(Object.isFrozen(vectorSegment?.elements)).toBe(true)
    expect(() =>
      (rendered.renderSegments as RenderSegment[]).push({
        canvas: document.createElement("canvas"),
        kind: "raster",
      }),
    ).toThrow()
  })
})
