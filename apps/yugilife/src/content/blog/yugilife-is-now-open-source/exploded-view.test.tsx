import { act } from "react"

import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ExplodedView } from "./exploded-view"
import { explodedViewPinchTransform } from "./exploded-view-gesture"

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}

afterEach(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe("blog exploded view", () => {
  it("zooms around the pinch midpoint while applying two-finger movement", () => {
    expect(
      explodedViewPinchTransform({
        center: { x: 100, y: 100 },
        distance: 200,
        initialDistance: 100,
        initialMidpoint: { x: 150, y: 80 },
        initialPan: { x: 10, y: 5 },
        initialZoom: 0.75,
        midpoint: { x: 160, y: 100 },
      }),
    ).toEqual({
      pan: { x: -20, y: 50 },
      zoom: 1.5,
    })
  })

  it("clamps pinch zoom to the exploded view limits", () => {
    expect(
      explodedViewPinchTransform({
        center: { x: 0, y: 0 },
        distance: 1_000,
        initialDistance: 10,
        initialMidpoint: { x: 0, y: 0 },
        initialPan: { x: 0, y: 0 },
        initialZoom: 1,
        midpoint: { x: 0, y: 0 },
      }).zoom,
    ).toBe(1.8)
  })

  it("tracks the Series 10 artwork layer order", () => {
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal(
      "ResizeObserver",
      class {
        disconnect() {}
        observe() {}
        unobserve() {}
      },
    )
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)

    act(() => root.render(<ExplodedView />))

    const layerIds = [...container.querySelectorAll<HTMLElement>("[data-layer]")].map(
      (layer) => layer.dataset.layer,
    )
    expect(layerIds).toHaveLength(32)
    expect(layerIds.indexOf("pendulumArtwork")).toBe(layerIds.indexOf("border") + 1)
    expect(layerIds.indexOf("pendulumArtwork")).toBeLessThan(
      layerIds.indexOf("pendulumXyzFrameTexture"),
    )
    expect(layerIds.indexOf("artworkOverlay")).toBeGreaterThan(layerIds.indexOf("frameBevel"))
    expect(layerIds.indexOf("artworkOverlay")).toBeLessThan(layerIds.indexOf("effectBoxTexture"))
    expect(
      [...container.querySelectorAll('[data-layer="rankStar"] image')].map((star) =>
        star.getAttribute("y"),
      ),
    ).toEqual(Array.from({ length: 7 }, () => "146"))

    act(() => root.unmount())
  })
})
