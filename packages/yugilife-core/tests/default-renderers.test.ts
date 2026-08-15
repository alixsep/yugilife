import { describe, expect, it } from "vitest"

import { createDefaultLayerRenderers } from "../src/rendering/default-renderers"

class FakeCanvasContext {
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

  fill() {}

  lineTo() {}

  moveTo() {}

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
