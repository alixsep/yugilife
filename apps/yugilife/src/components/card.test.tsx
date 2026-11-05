import { act } from "react"

import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderCard } from "yugilife-core"

import { Card } from "./card"

import type * as YugilifeCore from "yugilife-core"
import type {
  CardData,
  CardTemplate,
  CardTemplateBundle,
  RenderedCard,
  RenderOptions,
  RenderSegment,
} from "yugilife-core"

// The renderer is the core's business; these tests cover what the component does with renders:
// compositing order, superseded renders, cancellation, and when it asks for a new render.
vi.mock("yugilife-core", async (importOriginal) => ({
  ...(await importOriginal<typeof YugilifeCore>()),
  renderCard: vi.fn(),
}))

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

function rendered(segments: readonly RenderSegment[]): RenderedCard {
  return {
    createRenderManifest: () => Promise.resolve({ elements: [] }),
    presentation: {} as RenderedCard["presentation"],
    renderSegments: segments,
    template,
    toImage: () => Promise.resolve(new Blob()),
    toOutlinedSegments: () => Promise.resolve(segments),
    toPng: () => Promise.resolve(new Blob()),
    toSvg: () => Promise.resolve("<svg/>"),
    vectorLayers: [],
    warnings: [],
  }
}

const rect = (id: string): RenderSegment => ({
  elements: [{ attributes: { height: 1, id, width: 1 }, tag: "rect" }],
  kind: "vector",
})
const raster = (): RenderSegment => ({ canvas: document.createElement("canvas"), kind: "raster" })

function renderWith(
  implementation: (card: CardData, options: RenderOptions) => Promise<RenderedCard>,
) {
  vi.mocked(renderCard).mockImplementation(implementation)
}

function mount() {
  const container = document.createElement("div")
  document.body.append(container)
  return { container, root: createRoot(container) }
}

beforeEach(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  vi.mocked(renderCard).mockReset()
  renderWith(() => Promise.resolve(rendered([])))
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
    renderWith(() => Promise.resolve(rendered([raster(), rect("middle"), raster()])))
    const { container, root } = mount()

    await act(async () => {
      root.render(<Card card={{ name: "Ordered" }} templateBundle={stableTemplateBundle} />)
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
    renderWith(async (card) => {
      await (card["name"] === "First" ? first.promise : second.promise)
      return rendered([rect(String(card["name"]))])
    })
    const { container, root } = mount()

    await act(async () => {
      root.render(
        <Card card={{ name: "First" }} templateBundle={stableTemplateBundle} onReady={onReady} />,
      )
      await Promise.resolve()
    })
    await act(async () => {
      root.render(
        <Card card={{ name: "Second" }} templateBundle={stableTemplateBundle} onReady={onReady} />,
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
    let renderSignal: AbortSignal | undefined
    renderWith(async (_card, options) => {
      renderSignal = options.signal
      await pending.promise
      if (options.signal?.aborted) throw options.signal.reason
      return rendered([])
    })
    const { container, root } = mount()

    await act(async () => {
      root.render(
        <Card
          card={{ name: "Aborted" }}
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

    expect(renderSignal?.aborted).toBe(true)
    expect(onReady).not.toHaveBeenCalled()
    expect(container.firstElementChild?.hasAttribute("signal")).toBe(false)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    act(() => root.unmount())
  })

  it("uses immutable input identity and ignores callback identity", async () => {
    const card = { name: "Stable" }
    const layers = { deferred: true }
    const presetOverrides = { frame: "a" }
    const { root } = mount()

    const paint = async () => {
      await act(async () => {
        root.render(
          <Card
            card={card}
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
    expect(renderCard).toHaveBeenCalledTimes(1)

    await paint()
    await paint()
    expect(renderCard).toHaveBeenCalledTimes(1)

    await act(async () => {
      root.render(
        <Card
          card={{ name: "Changed" }}
          layers={layers}
          presetOverrides={presetOverrides}
          templateBundle={stableTemplateBundle}
        />,
      )
      await Promise.resolve()
    })
    expect(renderCard).toHaveBeenCalledTimes(2)

    act(() => root.unmount())
  })

  it("re-renders when object-backed artwork is replaced immutably", async () => {
    const sources = [
      new Blob(["first"], { type: "image/png" }),
      document.createElement("img"),
      document.createElement("canvas"),
      { height: 1, width: 1 } as ImageBitmap,
    ]
    const { root } = mount()

    for (const [index, artwork] of sources.entries()) {
      await act(async () => {
        root.render(
          <Card
            card={{ artwork, name: `Artwork ${index}` }}
            templateBundle={stableTemplateBundle}
          />,
        )
        await Promise.resolve()
      })
    }

    expect(vi.mocked(renderCard).mock.calls.map(([card]) => card["artwork"])).toEqual(sources)
    act(() => root.unmount())
  })

  it("re-renders when an immutable template is replaced", async () => {
    const bundles = [bundle({ ...template }), bundle({ ...template })]
    const { root } = mount()

    for (const templateBundle of bundles) {
      await act(async () => {
        root.render(<Card card={{ name: "Template" }} templateBundle={templateBundle} />)
        await Promise.resolve()
      })
    }

    const rendered = vi.mocked(renderCard).mock.calls.map(([, options]) => options.templateBundle)
    expect(rendered).toHaveLength(2)
    expect(rendered[0]).toBe(bundles[0])
    expect(rendered[1]).toBe(bundles[1])
    act(() => root.unmount())
  })

  it("accepts circular layer options and supports explicit mutable invalidation", async () => {
    const circularOptions: Record<string, unknown> = {}
    circularOptions["self"] = circularOptions
    const mutableCard = { name: "Mutable" }
    const circularBundle = bundle({
      ...template,
      layers: [{ id: "deferred", kind: "deferred", options: circularOptions }],
    })
    const { root } = mount()

    await act(async () => {
      root.render(<Card card={mutableCard} renderRevision={0} templateBundle={circularBundle} />)
      await Promise.resolve()
    })
    mutableCard.name = "Mutated in place"
    await act(async () => {
      root.render(<Card card={mutableCard} renderRevision={1} templateBundle={circularBundle} />)
      await Promise.resolve()
    })

    expect(renderCard).toHaveBeenCalledTimes(2)
    act(() => root.unmount())
  })
})
