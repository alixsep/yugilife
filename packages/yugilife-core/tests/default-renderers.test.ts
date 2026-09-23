import { describe, expect, it } from "vitest"

import { createDefaultLayerRenderers } from "../src/rendering/default-renderers"

class FakeCanvasContext {
  readonly clips: number[][] = []
  readonly drawImages: unknown[][] = []
  readonly fillStyles: string[] = []
  readonly globalAlphas: number[] = []

  private currentFillStyle = ""
  private currentGlobalAlpha = 1

  get fillStyle() {
    return this.currentFillStyle
  }

  set fillStyle(value: string) {
    this.currentFillStyle = value
    this.fillStyles.push(value)
  }

  get globalAlpha() {
    return this.currentGlobalAlpha
  }

  set globalAlpha(value: number) {
    this.currentGlobalAlpha = value
    this.globalAlphas.push(value)
  }

  beginPath() {}

  closePath() {}

  clip() {}

  drawImage(...values: unknown[]) {
    this.drawImages.push(values)
  }

  fill() {}

  lineTo() {}

  moveTo() {}

  rect(...values: number[]) {
    this.clips.push(values)
  }

  restore() {}

  save() {}
}

function bevelLayer(options: Record<string, unknown>) {
  return {
    id: "bevel",
    kind: "canvas" as const,
    options,
    region: { height: 10, width: 10, x: 0, y: 0 },
    renderer: "bevel",
  }
}

async function renderBevel(options: Record<string, unknown>) {
  const context = new FakeCanvasContext()
  const renderer = createDefaultLayerRenderers().bevel
  if (!renderer) throw new Error("The default bevel renderer is missing.")
  await renderer.render(
    { context: context as unknown as CanvasRenderingContext2D } as never,
    bevelLayer(options),
  )
  return context
}

describe("default bevel renderer", () => {
  it("defaults omitted opacity options to one", async () => {
    const context = await renderBevel({
      highlightColor: "#ffffff52",
      shadowColor: "#0000005e",
      thickness: { bottom: 1, left: 1, right: 1, top: 1 },
    })

    expect(context.globalAlphas).toEqual([1, 1, 1, 1])
  })

  it("continues to honor numeric opacity options", async () => {
    const context = await renderBevel({
      highlightColor: "#ffffff",
      highlightOpacity: 0.32,
      shadowColor: "#000000",
      shadowOpacity: 0.37,
      thickness: { bottom: 1, left: 1, right: 1, top: 1 },
    })

    expect(context.globalAlphas).toEqual([0.32, 0.32, 0.37, 0.37])
  })
})

describe("default artwork renderer", () => {
  it("shares a normalized crop transform while retaining template placement and clipping", async () => {
    const context = new FakeCanvasContext()
    const drawable = { height: 300, width: 600 }
    const renderer = createDefaultLayerRenderers().artwork
    if (!renderer) throw new Error("The default artwork renderer is missing.")

    await renderer.render(
      {
        card: { artwork: drawable },
        context: context as unknown as CanvasRenderingContext2D,
        presentation: {
          artworkTransforms: { shared: { scale: 2, x: 0.25, y: -0.5 } },
        },
      } as never,
      {
        field: "artwork",
        fit: "width",
        id: "artwork",
        kind: "artwork",
        placementRegion: { height: 400, width: 300, x: 100, y: 200 },
        region: { height: 900, width: 700, x: 50, y: 60 },
        transformId: "shared",
      },
    )

    expect(context.clips).toEqual([[50, 60, 700, 900]])
    expect(context.drawImages).toEqual([[drawable, 25, -75, 600, 300]])
  })

  it("emits a mode-gated artwork layer only for the matching opaque transform mode", async () => {
    const renderer = createDefaultLayerRenderers().artwork
    if (!renderer) throw new Error("The default artwork renderer is missing.")
    const drawable = { height: 300, width: 600 }
    const layer = {
      field: "artwork",
      id: "overlay",
      kind: "artwork",
      placementRegion: { height: 400, width: 300, x: 100, y: 200 },
      region: { height: 900, width: 700, x: 50, y: 60 },
      transformId: "shared",
      transformMode: "expanded",
    } as const

    const disabled = new FakeCanvasContext()
    const disabledResult = await renderer.render(
      {
        card: { artwork: drawable },
        context: disabled as unknown as CanvasRenderingContext2D,
        presentation: { artworkTransforms: { shared: { scale: 1, x: 0, y: 0 } } },
      } as never,
      layer,
    )
    expect(disabledResult).toBe(false)
    expect(disabled.clips).toEqual([])
    expect(disabled.drawImages).toEqual([])

    const enabled = new FakeCanvasContext()
    const enabledResult = await renderer.render(
      {
        card: { artwork: drawable },
        context: enabled as unknown as CanvasRenderingContext2D,
        presentation: {
          artworkTransforms: { shared: { mode: "expanded", scale: 1, x: 0, y: 0 } },
        },
      } as never,
      layer,
    )
    expect(enabledResult).toBe(true)
    expect(enabled.clips).toEqual([[50, 60, 700, 900]])
    expect(enabled.drawImages).toHaveLength(1)
  })
})
