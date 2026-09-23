import { afterEach, describe, expect, it, vi } from "vitest"

import {
  renderCard,
  resolveCardPresentation,
  validateCardTemplate,
  validatePresentationOverrides,
} from "../src"
import { scopeMaskAlpha } from "../src/rendering/canvas-masks"
import { clearScratchCanvasPool } from "../src/rendering/scratch-canvas"

import { NAME_FIELD, testTemplate, testTemplateBundle } from "./fixtures"

import type { CardTemplate } from "../src"
import type { LayerRenderer } from "../src/contracts"
import type { Mock } from "vitest"

type TestMock = Mock<(...args: unknown[]) => unknown>

interface MockCanvasContext {
  canvas: HTMLCanvasElement
  clearRect: TestMock
  drawImage: TestMock
  getImageData: TestMock
  putImageData: TestMock
  restore: TestMock
  save: TestMock
  setTransform: TestMock
  globalAlpha: number
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
      // An isolation surface is borrowed from the scratch pool, which resets the state a previous
      // holder left on it. A stub without these is not a canvas context.
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => {
        if (canvas.width === 2 && canvas.height === 1) {
          return { data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]) }
        }
        return { data: new Uint8ClampedArray(canvas.width * canvas.height * 4) }
      }),
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      putImageData: vi.fn(),
      restore: vi.fn(),
      save: vi.fn(),
      setTransform: vi.fn(),
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
  // Surfaces outlive a test through the pool, and with them the mock contexts and the calls
  // recorded on them. Each test starts from an empty pool so it observes only its own render.
  clearScratchCanvasPool()
  vi.restoreAllMocks()
})

describe("canvas masks", () => {
  it("scopes attenuation to actual source-layer alpha", () => {
    expect(scopeMaskAlpha(204, 255)).toBe(204)
    expect(scopeMaskAlpha(204, 128)).toBe(229)
    expect(scopeMaskAlpha(204, 0)).toBe(255)
  })

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
    // Both masked layers composed away from the card, once each. They may well have done it on the
    // same borrowed surface — the pooling test below is the one that pins that down.
    const isolationSaves = new Set([maskedA, maskedB])
    expect(
      [...isolationSaves].reduce((total, c) => total + (c?.save.mock.calls.length ?? 0), 0),
    ).toBe(2)
    expect(before?.save).not.toHaveBeenCalled()
    expect(middle?.save).not.toHaveBeenCalled()
    expect(after?.save).not.toHaveBeenCalled()
    expect(
      [...allContexts].filter((context) => context.getImageData.mock.calls.length > 0),
    ).toHaveLength(1)
  })

  it("composes consecutive masked layers on one borrowed surface, cleared between them", async () => {
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

    await renderCard(
      { name: "Masked card", variant: "masked" },
      {
        assets: { "mask.asset": mask },
        layerRenderers: { "test-raster": rasterRenderer },
        templateBundle: testTemplateBundle(maskTemplate()),
      },
    )

    const maskedA = observedContexts.get("masked-a")
    const maskedB = observedContexts.get("masked-b")
    // The first masked layer is drawn into the card and its surface handed back before the second
    // one asks for a surface, so the card pays for one isolation surface rather than one per layer.
    expect(maskedB).toBe(maskedA)
    // Which is only sound because a borrowed surface arrives empty: the second layer must not
    // inherit the first one's pixels.
    expect(maskedA?.clearRect).toHaveBeenCalledWith(0, 0, 100, 150)
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
          masks: [
            {
              assetId: "mask.asset",
              coverageLayerId: "missing",
              id: "mask",
            },
          ],
        }),
      ),
    ).toThrow(/references unknown coverage layer "missing"/)

    expect(() =>
      validateCardTemplate(
        maskTemplate({
          masks: [{ assetId: "mask.asset", coverageLayerId: "after", id: "bottom-half" }],
        }),
      ),
    ).toThrow(/coverage layer "after" does not render before that layer/)

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

  it("rejects an override that consults coverage which has not rendered yet", () => {
    const template = validateCardTemplate(
      maskTemplate({
        masks: [
          { assetId: "mask.asset", id: "bottom-half" },
          { assetId: "mask.asset", coverageLayerId: "middle", id: "scoped" },
        ],
      }),
    )

    expect(() =>
      validatePresentationOverrides({ layerMasks: { "masked-b": "scoped" } }, template),
    ).not.toThrow()
    expect(() =>
      validatePresentationOverrides({ layerMasks: { "masked-a": "scoped" } }, template),
    ).toThrow(/coverage layer "middle" does not render before that layer/)
  })
})
