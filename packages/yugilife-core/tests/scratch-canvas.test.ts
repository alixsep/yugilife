import { afterEach, describe, expect, it, vi } from "vitest"

import {
  acquireScratchCanvas,
  clearScratchCanvasPool,
  releaseScratchCanvas,
} from "../src/rendering/scratch-canvas"

interface StubState {
  /** `willReadFrequently` as requested by each `getContext` call, in order. */
  readonly attributes: (boolean | undefined)[]
  readonly clears: number[][]
  readonly transforms: number[][]
}

function stubCanvasContexts(): StubState {
  const state: StubState = { attributes: [], clears: [], transforms: [] }
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>()
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
    _contextId: string,
    options?: { willReadFrequently?: boolean },
  ) {
    state.attributes.push(options?.willReadFrequently)
    let context = contexts.get(this)
    if (!context) {
      context = {
        canvas: this,
        clearRect: (...args: number[]) => state.clears.push(args),
        globalAlpha: 1,
        globalCompositeOperation: "source-over",
        setTransform: (...args: number[]) => state.transforms.push(args),
      } as unknown as CanvasRenderingContext2D
      contexts.set(this, context)
    }
    return context
  } as never)
  return state
}

afterEach(() => {
  clearScratchCanvasPool()
  vi.restoreAllMocks()
})

describe("scratch canvas pool", () => {
  it("reuses a released surface and resets the state it was left in", () => {
    const state = stubCanvasContexts()

    const first = acquireScratchCanvas(40, 30)
    first.context.globalCompositeOperation = "destination-in"
    first.context.globalAlpha = 0.5
    releaseScratchCanvas(first)

    const second = acquireScratchCanvas(40, 30)

    expect(second.canvas).toBe(first.canvas)
    expect(second.context.globalCompositeOperation).toBe("source-over")
    expect(second.context.globalAlpha).toBe(1)
    expect(state.clears).toEqual([[0, 0, 40, 30]])
    expect(state.transforms).toEqual([[1, 0, 0, 1, 0, 0]])
  })

  it("keeps readback surfaces separate, because context attributes are fixed at creation", () => {
    const state = stubCanvasContexts()

    const composing = acquireScratchCanvas(40, 30)
    const reading = acquireScratchCanvas(40, 30, true)

    expect(state.attributes).toEqual([false, true])
    expect(reading.canvas).not.toBe(composing.canvas)

    releaseScratchCanvas(composing)
    releaseScratchCanvas(reading)

    expect(acquireScratchCanvas(40, 30).canvas).toBe(composing.canvas)
    expect(acquireScratchCanvas(40, 30, true).canvas).toBe(reading.canvas)
  })

  it("holds a borrowed surface exclusively so overlapping renders cannot share one", () => {
    stubCanvasContexts()

    const preview = acquireScratchCanvas(40, 30)
    const exporting = acquireScratchCanvas(40, 30)

    expect(exporting.canvas).not.toBe(preview.canvas)
  })
})
