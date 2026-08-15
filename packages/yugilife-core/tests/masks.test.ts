import { afterEach, describe, expect, it, vi } from "vitest"

import { renderCard, resolveCardPresentation, validateCardTemplate } from "../src"

import { NAME_FIELD, testTemplate, testTemplateBundle } from "./fixtures"

import type { CardTemplate } from "../src"
import type { LayerRenderer } from "../src/contracts"
import type { Mock } from "vitest"

type TestMock = Mock<(...args: unknown[]) => unknown>

interface MockCanvasContext {
  canvas: HTMLCanvasElement
  drawImage: TestMock
  getImageData: TestMock
  putImageData: TestMock
  restore: TestMock
  save: TestMock
  globalCompositeOperation: GlobalCompositeOperation
}

const contexts = new WeakMap<HTMLCanvasElement, MockCanvasContext>()
const allContexts = new Set<MockCanvasContext>()
const observedContexts = new Map<string, MockCanvasContext>()

function contextFor(canvas: HTMLCanvasElement) {
  let context = contexts.get(canvas)
  if (!context) {
    context = {
      canvas,
      drawImage: vi.fn(),
      getImageData: vi.fn(() => {
        if (canvas.width === 2 && canvas.height === 1) {
          return { data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]) }
        }
        return { data: new Uint8ClampedArray(canvas.width * canvas.height * 4) }
      }),
      globalCompositeOperation: "source-over",
      putImageData: vi.fn(),
      restore: vi.fn(),
      save: vi.fn(),
    }
    contexts.set(canvas, context)
    allContexts.add(context)
  }
  return context
}

const rasterRenderer: LayerRenderer = {
  output: "raster",
  render({ context }, layer) {
    const targetContext = contextFor(context.canvas)
    observedContexts.set(layer.id, targetContext)
    targetContext.drawImage(layer.id)
    return true
  },
}

function maskTemplate(overrides: Partial<CardTemplate> = {}): CardTemplate {
  return testTemplate({
    schemaVersion: 1,
    cardFields: [
      NAME_FIELD,
      {
        defaultValue: "masked",
        kind: "text",
        label: "Variant",
        name: "variant",
        options: ["masked", "plain"],
      },
    ],
    layers: [
      { id: "before", kind: "test-raster" },
      { id: "masked-a", kind: "test-raster" },
      { id: "middle", kind: "test-raster" },
      { id: "masked-b", kind: "test-raster" },
      { id: "after", kind: "test-raster" },
    ],
    masks: [{ assetId: "mask.asset", id: "bottom-half" }],
    presentationRules: [
      {
        id: "masked-variant",
        maskSelections: { "masked-a": "bottom-half", "masked-b": "bottom-half" },
        when: { equals: "masked", path: "variant" },
      },
    ],
    semanticBindings: {
      bindings: [{ path: "variant", source: { field: "variant" } }],
    },
    ...overrides,
  })
}

afterEach(() => {
  allContexts.clear()
  observedContexts.clear()
  vi.restoreAllMocks()
})

describe("canvas masks", () => {
  it("resolves arbitrary layer assignments and advanced removals", () => {
    const template = validateCardTemplate(maskTemplate())
    const semantics = { values: { variant: "masked" } }

    expect(resolveCardPresentation(template, semantics).layerMasks).toMatchObject({
      "masked-a": { id: "bottom-half", channel: "luminance", invert: false },
      "masked-b": { id: "bottom-half", channel: "luminance", invert: false },
    })
    expect(
      resolveCardPresentation(template, semantics, {
        layerMasks: { "masked-a": null, after: "bottom-half" },
      }).layerMasks,
    ).toMatchObject({
      "masked-b": { id: "bottom-half" },
      after: { id: "bottom-half" },
    })
  })

  it("isolates a masked raster-only group once for all of its children", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      return contextFor(this) as unknown as CanvasRenderingContext2D
    })
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,cmFzdGVy",
    )
    const mask = document.createElement("canvas")
    mask.width = 100
    mask.height = 150
    const template = maskTemplate({
      layers: [
        { id: "before", kind: "test-raster" },
        {
          id: "masked-group",
          kind: "group",
          layers: [
            { id: "masked-a", kind: "test-raster" },
            { id: "masked-b", kind: "test-raster" },
          ],
        },
        { id: "after", kind: "test-raster" },
      ],
      presentationRules: [
        {
          id: "masked-variant",
          maskSelections: { "masked-group": "bottom-half" },
          when: { equals: "masked", path: "variant" },
        },
      ],
    })

    await renderCard(
      { name: "Masked group", variant: "masked" },
      {
        assets: { "mask.asset": mask },
        layerRenderers: { "test-raster": rasterRenderer },
        templateBundle: testTemplateBundle(template),
      },
    )

    const maskedA = observedContexts.get("masked-a")
    const maskedB = observedContexts.get("masked-b")
    const after = observedContexts.get("after")
    expect(maskedA).toBeTruthy()
    expect(maskedB).toBe(maskedA)
    expect(maskedA).not.toBe(after)
    expect(maskedA?.save).toHaveBeenCalledTimes(1)
    expect(
      [...allContexts].filter((context) => context.getImageData.mock.calls.length > 0),
    ).toHaveLength(1)
  })

  it("rejects a masked group with vector descendants", async () => {
    const template = maskTemplate({
      layers: [
        {
          id: "masked-group",
          kind: "group",
          layers: [{ id: "vector-child", kind: "test-vector" }],
        },
      ],
      presentationRules: [
        {
          id: "masked-variant",
          maskSelections: { "masked-group": "bottom-half" },
          when: { equals: "masked", path: "variant" },
        },
      ],
    })

    await expect(
      renderCard(
        { name: "Invalid masked group", variant: "masked" },
        {
          assets: { "mask.asset": document.createElement("canvas") },
          layerRenderers: { "test-vector": { output: "vector", render() {} } },
          templateBundle: testTemplateBundle(template),
        },
      ),
    ).rejects.toThrow(/can only target a raster-only group "masked-group"/)
  })

  it("isolates only targeted raster layers while preserving non-sequential order", async () => {
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(function (this: HTMLCanvasElement) {
        return contextFor(this) as unknown as CanvasRenderingContext2D
      })
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,cmFzdGVy",
    )
    const mask = document.createElement("canvas")
    mask.width = 100
    mask.height = 150
    const template = maskTemplate()

    const rendered = await renderCard(
      { name: "Masked card", variant: "masked" },
      {
        assets: { "mask.asset": mask },
        layerRenderers: { "test-raster": rasterRenderer },
        templateBundle: testTemplateBundle(template),
      },
    )

    expect(rendered.renderSegments.map((segment) => segment.kind)).toEqual(["raster"])
    const svg = await rendered.toSvg()
    expect(svg.match(/<image /g)).toHaveLength(1)
    expect(rendered.renderSegments.map((segment) => segment.kind)).toEqual(["raster"])
    expect(getContext).toHaveBeenCalled()

    const before = observedContexts.get("before")
    const maskedA = observedContexts.get("masked-a")
    const middle = observedContexts.get("middle")
    const maskedB = observedContexts.get("masked-b")
    const after = observedContexts.get("after")
    expect(before && maskedA && middle && maskedB && after).toBeTruthy()
    expect(maskedA).not.toBe(before)
    expect(maskedA).not.toBe(middle)
    expect(maskedB).not.toBe(middle)
    expect(maskedB).not.toBe(after)
    expect(maskedA?.save).toHaveBeenCalledTimes(1)
    expect(maskedB?.save).toHaveBeenCalledTimes(1)
    expect(before?.save).not.toHaveBeenCalled()
    expect(middle?.save).not.toHaveBeenCalled()
    expect(after?.save).not.toHaveBeenCalled()
    expect(
      [...allContexts].filter((context) => context.getImageData.mock.calls.length > 0),
    ).toHaveLength(1)
  })

  it("coalesces masked raster output without crossing vector boundaries", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      return contextFor(this) as unknown as CanvasRenderingContext2D
    })
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,cmFzdGVy",
    )
    const mask = document.createElement("canvas")
    mask.width = 100
    mask.height = 150
    const template = maskTemplate({
      layers: [
        { id: "before", kind: "test-raster" },
        { id: "between", kind: "test-vector" },
        { id: "masked", kind: "test-raster" },
        { id: "after", kind: "test-raster" },
      ],
      presentationRules: [
        {
          id: "masked-variant",
          maskSelections: { masked: "bottom-half" },
          when: { equals: "masked", path: "variant" },
        },
      ],
    })

    const rendered = await renderCard(
      { name: "Interleaved mask", variant: "masked" },
      {
        assets: { "mask.asset": mask },
        layerRenderers: {
          "test-raster": rasterRenderer,
          "test-vector": {
            output: "vector",
            render({ vectorLayers }) {
              vectorLayers.push({ attributes: { id: "between" }, tag: "g" })
            },
          },
        },
        templateBundle: testTemplateBundle(template),
      },
    )

    expect(rendered.renderSegments.map((segment) => segment.kind)).toEqual([
      "raster",
      "vector",
      "raster",
    ])
    expect(observedContexts.get("masked")).not.toBe(observedContexts.get("after"))
    const svg = await rendered.toSvg()
    const firstImage = svg.indexOf("<image ")
    const vector = svg.indexOf('id="between"')
    const secondImage = svg.indexOf("<image ", firstImage + 1)
    expect(firstImage).toBeLessThan(vector)
    expect(vector).toBeLessThan(secondImage)
  })

  it("rejects a vector-output target at the render boundary", async () => {
    const template = maskTemplate({
      layers: [{ id: "vector-target", kind: "test-vector" }],
      presentationRules: [
        {
          id: "mask-vector",
          maskSelections: { "vector-target": "bottom-half" },
          when: { equals: "masked", path: "variant" },
        },
      ],
    })

    await expect(
      renderCard(
        { name: "Invalid target", variant: "masked" },
        {
          assets: { "mask.asset": document.createElement("canvas") },
          layerRenderers: {
            "test-vector": { output: "vector", render() {} },
          },
          templateBundle: testTemplateBundle(template),
        },
      ),
    ).rejects.toThrow(/can only target raster-output layer "vector-target"/)
  })

  it("converts opaque black/white luminance into reusable alpha coverage", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      return contextFor(this) as unknown as CanvasRenderingContext2D
    })
    const mask = document.createElement("canvas")
    mask.width = 2
    mask.height = 1

    await renderCard(
      { name: "Coverage card", variant: "masked" },
      {
        assets: { "mask.asset": mask },
        layerRenderers: { "test-raster": rasterRenderer },
        templateBundle: testTemplateBundle(maskTemplate({ dimensions: { width: 2, height: 1 } })),
      },
    )

    const preparedMaskContext = [...allContexts].find(
      (context) => context.putImageData.mock.calls.length > 0,
    )
    const imageData = preparedMaskContext?.putImageData.mock.calls[0]?.[0] as
      { data: Uint8ClampedArray } | undefined
    expect([...(imageData?.data ?? [])]).toEqual([255, 255, 255, 255, 255, 255, 255, 0])
  })

  it("validates mask definitions and rule references", () => {
    expect(() =>
      validateCardTemplate(
        maskTemplate({ masks: [{ assetId: "mask.asset", id: "mask", channel: "red" as never }] }),
      ),
    ).toThrow(/channel must be "alpha" or "luminance"/)

    expect(() =>
      validateCardTemplate(
        maskTemplate({
          presentationRules: [
            {
              id: "unknown-mask",
              maskSelections: { "masked-a": "missing" },
              when: { equals: "masked", path: "variant" },
            },
          ],
        }),
      ),
    ).toThrow(/references unknown mask "missing"/)
  })
})
