import { act } from "react"

import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MapAssetResolver } from "yugilife-core"

import { Card } from "./card"

import type { CardTemplate, CardTemplateBundle } from "yugilife-core"
import type { LayerRenderer } from "yugilife-core/advanced"

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}

const template: CardTemplate = {
  schemaVersion: 1,
  dimensions: { width: 100, height: 150 },
  cardFields: [
    { defaultValue: "Test card", kind: "text", label: "Name", name: "name", required: true },
  ],
  layers: [{ id: "deferred", kind: "deferred" }],
}

function bundle(value: CardTemplate): CardTemplateBundle {
  return {
    assets: {},
    colorPresets: {},
    manifest: {
      assets: {},
      id: "card/component-test",
      kind: "card",
      name: "Component test",
      template: "template.json",
      version: "2026.01.01",
    },
    template: value,
  }
}

const stableTemplateBundle = bundle(template)

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

beforeEach(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect() {},
    drawImage() {},
  } as unknown as CanvasRenderingContext2D)
})

afterEach(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe("Card render ordering", () => {
  it("renders raster and vector segments in declared DOM compositing order", async () => {
    const orderedTemplate: CardTemplate = {
      ...template,
      layers: [
        { id: "raster-before", kind: "test-raster" },
        { id: "vector-middle", kind: "vector" },
        { id: "raster-after", kind: "test-raster" },
      ],
    }
    const layerRenderers = {
      "test-raster": { output: "raster" as const, render() {} },
      vector: {
        output: "vector" as const,
        render({ vectorLayers }: Parameters<LayerRenderer["render"]>[0]) {
          vectorLayers.push({
            attributes: { height: 1, id: "middle", width: 1 },
            tag: "rect",
          })
        },
      },
    }
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <Card
          card={{ name: "Ordered" }}
          layerRenderers={layerRenderers}
          templateBundle={bundle(orderedTemplate)}
        />,
      )
      await Promise.resolve()
    })

    expect(
      [...(container.firstElementChild?.children ?? [])].map((element) =>
        element.tagName.toLocaleLowerCase(),
      ),
    ).toEqual(["canvas", "svg", "canvas"])
    expect(container.querySelector("svg rect")?.getAttribute("id")).toBe("middle")
    act(() => root.unmount())
  })

  it("does not let a superseded out-of-order render update the UI", async () => {
    const first = deferred()
    const second = deferred()
    const onReady = vi.fn()
    const renderer: LayerRenderer = {
      output: "vector",
      async render({ card, vectorLayers }) {
        await (card.name === "First" ? first.promise : second.promise)
        vectorLayers.push({ attributes: { id: card.name }, tag: "rect" })
      },
    }
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <Card
          card={{ name: "First" }}
          layerRenderers={{ deferred: renderer }}
          templateBundle={stableTemplateBundle}
          onReady={onReady}
        />,
      )
      await Promise.resolve()
    })
    await act(async () => {
      root.render(
        <Card
          card={{ name: "Second" }}
          layerRenderers={{ deferred: renderer }}
          templateBundle={stableTemplateBundle}
          onReady={onReady}
        />,
      )
      await Promise.resolve()
    })
    await act(async () => {
      second.resolve()
      await second.promise
      await Promise.resolve()
    })
    expect(container.querySelector("svg rect")?.getAttribute("id")).toBe("Second")
    expect(onReady).toHaveBeenCalledOnce()

    await act(async () => {
      first.resolve()
      await first.promise
      await Promise.resolve()
    })
    expect(container.querySelector("svg rect")?.getAttribute("id")).toBe("Second")
    expect(onReady).toHaveBeenCalledOnce()

    act(() => root.unmount())
  })

  it("honors a caller signal without forwarding it as a DOM attribute", async () => {
    const pending = deferred()
    const controller = new AbortController()
    const onReady = vi.fn()
    const renderer: LayerRenderer = {
      output: "raster",
      async render() {
        await pending.promise
      },
    }
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <Card
          card={{ name: "Aborted" }}
          layerRenderers={{ deferred: renderer }}
          signal={controller.signal}
          templateBundle={stableTemplateBundle}
          onReady={onReady}
        />,
      )
      await Promise.resolve()
    })
    await act(async () => {
      controller.abort(new Error("caller stopped rendering"))
      pending.resolve()
      await pending.promise
      await Promise.resolve()
    })

    expect(onReady).not.toHaveBeenCalled()
    expect(container.firstElementChild?.hasAttribute("signal")).toBe(false)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    act(() => root.unmount())
  })

  it("uses immutable input identity and ignores callback identity", async () => {
    let renders = 0
    const renderer: LayerRenderer = {
      output: "raster",
      render() {
        renders += 1
      },
    }
    const card = { name: "Stable" }
    const layerRenderers = { deferred: renderer }
    const layers = { deferred: true }
    const presetOverrides = { frame: "a" }
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)

    const paint = async () => {
      await act(async () => {
        root.render(
          <Card
            card={card}
            layerRenderers={layerRenderers}
            layers={layers}
            presetOverrides={presetOverrides}
            templateBundle={stableTemplateBundle}
            onError={() => {}}
            onReady={() => {}}
          />,
        )
        await Promise.resolve()
      })
    }

    await paint()
    expect(renders).toBe(1)

    await paint()
    await paint()
    expect(renders).toBe(1)

    await act(async () => {
      root.render(
        <Card
          card={{ name: "Changed" }}
          layerRenderers={layerRenderers}
          layers={layers}
          presetOverrides={presetOverrides}
          templateBundle={stableTemplateBundle}
        />,
      )
      await Promise.resolve()
    })
    expect(renders).toBe(2)

    act(() => root.unmount())
  })

  it("re-renders when object-backed artwork is replaced immutably", async () => {
    const observed: unknown[] = []
    const renderer: LayerRenderer = {
      output: "raster",
      render({ card }) {
        observed.push(card["artwork"])
      },
    }
    const layerRenderers = { deferred: renderer }
    const sources = [
      new Blob(["first"], { type: "image/png" }),
      document.createElement("img"),
      document.createElement("canvas"),
      { height: 1, width: 1 } as ImageBitmap,
    ]
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)

    for (const [index, artwork] of sources.entries()) {
      await act(async () => {
        root.render(
          <Card
            card={{ artwork, name: `Artwork ${index}` }}
            layerRenderers={layerRenderers}
            templateBundle={stableTemplateBundle}
          />,
        )
        await Promise.resolve()
      })
    }

    expect(observed).toEqual(sources)
    act(() => root.unmount())
  })

  it("re-renders when a resolver-bearing immutable template is replaced", async () => {
    const observed: unknown[] = []
    const renderer: LayerRenderer = {
      output: "raster",
      render(_context, layer) {
        const resolverLayer = layer as typeof layer & { resolver?: unknown }
        observed.push(resolverLayer.resolver)
      },
    }
    const layerRenderers = { deferred: renderer }
    const firstResolver = new MapAssetResolver({})
    const secondResolver = new MapAssetResolver({})
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)

    for (const resolver of [firstResolver, secondResolver]) {
      await act(async () => {
        root.render(
          <Card
            card={{ name: "Resolver" }}
            layerRenderers={layerRenderers}
            templateBundle={bundle({
              ...template,
              layers: [{ id: "deferred", kind: "deferred", resolver }],
            })}
          />,
        )
        await Promise.resolve()
      })
    }

    expect(observed).toEqual([firstResolver, secondResolver])
    act(() => root.unmount())
  })

  it("accepts circular custom layer options and supports explicit mutable invalidation", async () => {
    let renders = 0
    const circularOptions: Record<string, unknown> = {}
    circularOptions["self"] = circularOptions
    const mutableCard = { name: "Mutable" }
    const circularTemplate: CardTemplate = {
      ...template,
      layers: [{ id: "deferred", kind: "deferred", options: circularOptions }],
    }
    const layerRenderers = {
      deferred: {
        output: "raster" as const,
        render() {
          renders += 1
        },
      },
    }
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <Card
          card={mutableCard}
          layerRenderers={layerRenderers}
          renderRevision={0}
          templateBundle={bundle(circularTemplate)}
        />,
      )
      await Promise.resolve()
    })
    mutableCard.name = "Mutated in place"
    await act(async () => {
      root.render(
        <Card
          card={mutableCard}
          layerRenderers={layerRenderers}
          renderRevision={1}
          templateBundle={bundle(circularTemplate)}
        />,
      )
      await Promise.resolve()
    })

    expect(renders).toBe(2)
    act(() => root.unmount())
  })
})
