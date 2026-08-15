import { afterEach, describe, expect, it, vi } from "vitest"

import { renderCard } from "../src"

import { NAME_FIELD, testTemplateBundle } from "./fixtures"

import type { LayerRenderer } from "../src/contracts"

const template = {
  schemaVersion: 1,
  dimensions: { width: 100, height: 150 },
  cardFields: [NAME_FIELD],
  layers: [{ id: "deferred", kind: "deferred" }],
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("overlapping render cancellation", () => {
  it("allows a newer render to finish first and rejects the superseded render", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as CanvasRenderingContext2D,
    )
    const first = deferred()
    const second = deferred()
    const controller = new AbortController()
    const renderer: LayerRenderer = {
      output: "vector",
      async render({ card, vectorLayers }) {
        const pending = card.name === "First" ? first : second
        await pending.promise
        vectorLayers.push({ tag: "text", text: card.name })
      },
    }

    const older = renderCard(
      { name: "First" },
      {
        layerRenderers: { deferred: renderer },
        signal: controller.signal,
        templateBundle: testTemplateBundle(template),
      },
    )
    const newer = renderCard(
      { name: "Second" },
      { layerRenderers: { deferred: renderer }, templateBundle: testTemplateBundle(template) },
    )
    controller.abort()
    second.resolve()

    await expect(newer).resolves.toMatchObject({
      vectorLayers: [{ tag: "text", text: "Second" }],
    })
    first.resolve()
    await expect(older).rejects.toMatchObject({ name: "AbortError" })
  })

  it("keeps independent out-of-order results scoped to their own render", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as CanvasRenderingContext2D,
    )
    const first = deferred()
    const second = deferred()
    const renderer: LayerRenderer = {
      output: "vector",
      async render({ card, vectorLayers }) {
        await (card.name === "First" ? first.promise : second.promise)
        vectorLayers.push({ tag: "text", text: card.name })
      },
    }
    const older = renderCard(
      { name: "First" },
      { layerRenderers: { deferred: renderer }, templateBundle: testTemplateBundle(template) },
    )
    const newer = renderCard(
      { name: "Second" },
      { layerRenderers: { deferred: renderer }, templateBundle: testTemplateBundle(template) },
    )

    second.resolve()
    await expect(newer).resolves.toMatchObject({
      vectorLayers: [{ tag: "text", text: "Second" }],
    })
    first.resolve()
    await expect(older).resolves.toMatchObject({
      vectorLayers: [{ tag: "text", text: "First" }],
    })
  })

  it("reports AbortError when an in-flight renderer fails after cancellation", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as CanvasRenderingContext2D,
    )
    let fail!: (error: Error) => void
    const pending = new Promise<void>((_resolve, reject) => {
      fail = reject
    })
    const started = deferred()
    const renderer: LayerRenderer = {
      output: "raster",
      async render() {
        started.resolve()
        await pending
      },
    }
    const controller = new AbortController()
    const rendering = renderCard(
      { name: "Cancelled failure" },
      {
        layerRenderers: { deferred: renderer },
        signal: controller.signal,
        templateBundle: testTemplateBundle(template),
      },
    )
    const rejected = expect(rendering).rejects.toMatchObject({ name: "AbortError" })

    await started.promise
    controller.abort()
    fail(new Error("late renderer failure"))

    await rejected
  })
})
