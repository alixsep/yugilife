/**
 * Short-lived full-card compositing surfaces.
 *
 * Renderers that must compose a layer in isolation need a canvas only between acquiring it and
 * drawing the finished result into the destination context. Allocating one per render makes the
 * interactive preview loop create and discard multi-megabyte surfaces on every keystroke, crop
 * drag, and slider change. A borrowed surface is exclusively owned by its holder until it is
 * released, so an `await` between acquire and release cannot let a concurrent render observe it.
 *
 * This is a pool, not a cache: nothing is keyed by content, so a pooled surface can never return
 * stale pixels. Acquiring always clears the surface and resets the drawing state it may have been
 * left in.
 */

/** Context attributes are fixed at the first `getContext` call, so they belong in the pool key. */
interface ScratchCanvasKey {
  readonly width: number
  readonly height: number
  readonly willReadFrequently: boolean
}

export interface ScratchCanvas {
  readonly canvas: HTMLCanvasElement
  readonly context: CanvasRenderingContext2D
  readonly key: string
}

/** Two renders (an interactive preview and an export) may legitimately overlap. */
const MAX_POOLED_PER_KEY = 2

const pools = new Map<string, ScratchCanvas[]>()

function poolKey({ width, height, willReadFrequently }: ScratchCanvasKey) {
  return `${width}x${height}${willReadFrequently ? ":readback" : ""}`
}

/**
 * Borrows a cleared surface of the requested size. Pass `willReadFrequently` only when the caller
 * reads pixels back: the hint keeps the surface in main memory, which is slower to draw with.
 */
export function acquireScratchCanvas(
  width: number,
  height: number,
  willReadFrequently = false,
): ScratchCanvas {
  const key = poolKey({ height, width, willReadFrequently })
  const pooled = pools.get(key)?.pop()
  if (pooled) {
    pooled.context.setTransform(1, 0, 0, 1, 0, 0)
    pooled.context.globalCompositeOperation = "source-over"
    pooled.context.globalAlpha = 1
    pooled.context.clearRect(0, 0, width, height)
    return pooled
  }

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d", { willReadFrequently })
  if (!context) throw new Error("A 2D canvas context is required to compose a card layer.")
  return { canvas, context, key }
}

/** Returns a surface to the pool. The caller must not draw with it or read from it afterwards. */
export function releaseScratchCanvas(scratch: ScratchCanvas) {
  const pooled = pools.get(scratch.key)
  if (!pooled) {
    pools.set(scratch.key, [scratch])
    return
  }
  if (pooled.length >= MAX_POOLED_PER_KEY) return
  pooled.push(scratch)
}

/** Releases every pooled surface. Exposed for tests and for deliberate memory reclamation. */
export function clearScratchCanvasPool() {
  pools.clear()
}
