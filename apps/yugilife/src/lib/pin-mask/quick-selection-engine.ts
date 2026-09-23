import wasmUrl from "./quick-selection-kernels.wasm?url"
import { resampleAlpha } from "./resample-alpha"

import type { ArtworkMaskEffects, PinMaskPoint } from "./quick-selection-types"

interface MaskKernelExports extends WebAssembly.Exports {
  alloc(bytes: number): number
  memory: WebAssembly.Memory
  mask_effects_apply(
    rgbaPointer: number,
    width: number,
    height: number,
    antiAlias: number,
    glow: number,
  ): number
}

interface QuickSelectionExports extends MaskKernelExports {
  quick_error(): number
  quick_prepare(rgbaPointer: number, width: number, height: number): number
  quick_refine(seedPointer: number, outputPointer: number): number
  reset_heap(): void
}

interface AlphaKernelExports extends WebAssembly.Exports {
  alloc(bytes: number): number
  memory: WebAssembly.Memory
  mask_alpha_smooth(source: number, output: number, width: number, height: number): number
  mask_alpha_glow(alpha: number, width: number, height: number, glow: number): number
}

/**
 * Dot segmentation is intentionally bounded to a worker-side working plane. Artwork assets are
 * often 2K–4K square, while the superpixel graph does not gain useful detail from running every
 * pixel at that size. The resulting mask is expanded back to the source dimensions before it
 * crosses the worker boundary again, so card rendering and persisted masks retain native size.
 */
export const MAX_SELECTION_DIMENSION = 768

let modulePromise: Promise<WebAssembly.Module> | undefined

async function loadModule() {
  modulePromise ??= fetch(wasmUrl)
    .then((response) => {
      if (!response.ok)
        throw new Error(`Pin masking WASM failed to load (HTTP ${response.status}).`)
      return response.arrayBuffer()
    })
    .then((bytes) => WebAssembly.compile(bytes))
    .catch((reason: unknown) => {
      modulePromise = undefined
      throw reason
    })
  return await modulePromise
}

async function instantiateExports<T extends WebAssembly.Exports>() {
  const instance = await WebAssembly.instantiate(await loadModule())
  return instance.exports as T
}

function resampleRgba(
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
): { height: number; pixels: Uint8ClampedArray; width: number } {
  const longest = Math.max(sourceWidth, sourceHeight)
  if (longest <= MAX_SELECTION_DIMENSION) {
    return { height: sourceHeight, pixels: source, width: sourceWidth }
  }
  const ratio = MAX_SELECTION_DIMENSION / longest
  const width = Math.max(1, Math.round(sourceWidth * ratio))
  const height = Math.max(1, Math.round(sourceHeight * ratio))
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.max(0, Math.min(sourceHeight - 1, (y + 0.5) / ratio - 0.5))
    const top = Math.floor(sourceY)
    const bottom = Math.min(sourceHeight - 1, top + 1)
    const yWeight = sourceY - top
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.max(0, Math.min(sourceWidth - 1, (x + 0.5) / ratio - 0.5))
      const left = Math.floor(sourceX)
      const right = Math.min(sourceWidth - 1, left + 1)
      const xWeight = sourceX - left
      const destination = (y * width + x) * 4
      const topLeft = (top * sourceWidth + left) * 4
      const topRight = (top * sourceWidth + right) * 4
      const bottomLeft = (bottom * sourceWidth + left) * 4
      const bottomRight = (bottom * sourceWidth + right) * 4
      for (let channel = 0; channel < 4; channel += 1) {
        const topValue =
          source[topLeft + channel]! * (1 - xWeight) + source[topRight + channel]! * xWeight
        const bottomValue =
          source[bottomLeft + channel]! * (1 - xWeight) + source[bottomRight + channel]! * xWeight
        pixels[destination + channel] = Math.round(topValue * (1 - yWeight) + bottomValue * yWeight)
      }
    }
  }
  return { height, pixels, width }
}

/**
 * Stateful adapter around the checked-in masking kernel.
 *
 * This class deliberately has no DOM or React dependency. It is owned by the pin-mask worker;
 * keeping the mutable WASM heap and prepared-image state there prevents a long segmentation pass
 * from blocking the editor's event loop.
 */
export class QuickSelection {
  readonly #exports: QuickSelectionExports
  readonly #hardPointer: number
  readonly #outputPointer: number
  readonly #workingHeight: number
  readonly #workingWidth: number
  readonly height: number
  readonly width: number

  private constructor(
    exports: QuickSelectionExports,
    hardPointer: number,
    outputPointer: number,
    sourceWidth: number,
    sourceHeight: number,
    workingWidth: number,
    workingHeight: number,
  ) {
    this.#exports = exports
    this.#hardPointer = hardPointer
    this.#outputPointer = outputPointer
    this.#workingHeight = workingHeight
    this.#workingWidth = workingWidth
    this.height = sourceHeight
    this.width = sourceWidth
  }

  static async prepare(rgba: Uint8ClampedArray, width: number, height: number) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
      throw new Error("Pin masking requires positive whole-number image dimensions.")
    }
    const count = width * height
    if (!Number.isSafeInteger(count) || count > 0xffffffff || rgba.byteLength !== count * 4) {
      throw new Error("Pin masking received pixels with invalid image dimensions.")
    }
    const working = resampleRgba(rgba, width, height)
    const workingCount = working.width * working.height
    const exports = await instantiateExports<QuickSelectionExports>()
    exports.reset_heap()
    const imagePointer = exports.alloc(working.pixels.byteLength)
    const hardPointer = exports.alloc(workingCount)
    const outputPointer = exports.alloc(workingCount)
    if (!imagePointer || !hardPointer || !outputPointer) {
      throw new Error(
        `Pin masking could not allocate enough browser memory for the ${working.width}×${working.height} working plane.`,
      )
    }
    new Uint8Array(exports.memory.buffer).set(working.pixels, imagePointer)
    if (!exports.quick_prepare(imagePointer, working.width, working.height)) {
      if (exports.quick_error() === 5) {
        throw new Error(
          `Pin masking could not allocate enough browser memory for the ${working.width}×${working.height} working plane.`,
        )
      }
      throw new Error("Pin masking could not analyse this image.")
    }
    return new QuickSelection(
      exports,
      hardPointer,
      outputPointer,
      width,
      height,
      working.width,
      working.height,
    )
  }

  refine(points: readonly PinMaskPoint[]): Uint8Array<ArrayBuffer> {
    const count = this.#workingWidth * this.#workingHeight
    const seeds = new Uint8Array(count)
    seeds.fill(128)
    if (count > 0) {
      seeds[0] = 0
      seeds[this.#workingWidth - 1] = 0
      seeds[(this.#workingHeight - 1) * this.#workingWidth] = 0
      seeds[count - 1] = 0
    }
    const xScale =
      this.width > 1 ? (this.#workingWidth - 1) / (this.width - 1) : this.#workingWidth / this.width
    const yScale =
      this.height > 1
        ? (this.#workingHeight - 1) / (this.height - 1)
        : this.#workingHeight / this.height
    const sizeScale = Math.min(this.#workingWidth / this.width, this.#workingHeight / this.height)
    for (const point of points) {
      const x = point.x * xScale
      const y = point.y * yScale
      const radius = Math.max(1, (point.size * sizeScale) / 2)
      const left = Math.max(0, Math.floor(x - radius))
      const right = Math.min(this.#workingWidth - 1, Math.ceil(x + radius))
      const top = Math.max(0, Math.floor(y - radius))
      const bottom = Math.min(this.#workingHeight - 1, Math.ceil(y + radius))
      for (let y = top; y <= bottom; y += 1) {
        for (let x = left; x <= right; x += 1) {
          if (Math.hypot(x - point.x * xScale, y - point.y * yScale) <= radius) {
            seeds[y * this.#workingWidth + x] = point.polarity === "keep" ? 255 : 0
          }
        }
      }
    }
    new Uint8Array(this.#exports.memory.buffer).set(seeds, this.#hardPointer)
    if (!this.#exports.quick_refine(this.#hardPointer, this.#outputPointer)) {
      const error = this.#exports.quick_error()
      if (error === 5) {
        throw new Error(
          `Pin masking could not refine the selection because the ${this.#workingWidth}×${this.#workingHeight} working plane ran out of memory.`,
        )
      }
      throw new Error("Pin masking could not refine the selection.")
    }
    const workingMask = new Uint8Array(
      this.#exports.memory.buffer.slice(this.#outputPointer, this.#outputPointer + count),
    )
    return resampleAlpha(
      workingMask,
      this.#workingWidth,
      this.#workingHeight,
      this.width,
      this.height,
    )
  }
}

/** WASM-backed mask presentation processor used by the Yugilife editor only. */
export class MaskEffects {
  readonly #exports: AlphaKernelExports
  readonly #source: number
  readonly #output: number
  readonly #width: number
  readonly #height: number
  #smoothed = 0

  private constructor(
    exports: AlphaKernelExports,
    source: number,
    output: number,
    width: number,
    height: number,
  ) {
    this.#exports = exports
    this.#source = source
    this.#output = output
    this.#width = width
    this.#height = height
  }

  /** One immutable source per instance; anti-alias coverage is prepared lazily and reused. */
  static async prepare(alpha: Uint8Array, width: number, height: number) {
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      height < 1 ||
      !Number.isSafeInteger(width * height) ||
      alpha.length !== width * height
    ) {
      throw new Error("Artwork mask effects received pixels with invalid dimensions.")
    }
    const exports = await instantiateExports<AlphaKernelExports>()
    const source = exports.alloc(alpha.length)
    const output = exports.alloc(alpha.length)
    if (!source || !output)
      throw new Error("Artwork mask effects could not allocate source coverage.")
    new Uint8Array(exports.memory.buffer, source, alpha.length).set(alpha)
    return new MaskEffects(exports, source, output, width, height)
  }

  /** Borrowed WASM view: consume before the next process call; never transfer its buffer. */
  process(effects: ArtworkMaskEffects) {
    const size = this.#width * this.#height
    if (effects.antiAlias === true && !this.#smoothed) {
      const smoothed = this.#exports.alloc(size)
      if (!smoothed) throw new Error("Artwork mask effects could not allocate anti-alias coverage.")
      if (!this.#exports.mask_alpha_smooth(this.#source, smoothed, this.#width, this.#height)) {
        throw new Error("Artwork mask effects could not smooth this mask.")
      }
      this.#smoothed = smoothed
    }
    const source = effects.antiAlias === true ? this.#smoothed : this.#source
    const glow = Number.isFinite(effects.glow)
      ? Math.ceil(Math.max(0, Math.min(128, effects.glow ?? 0)))
      : 0
    if (!glow) return new Uint8Array(this.#exports.memory.buffer, source, size)
    const memory = new Uint8Array(this.#exports.memory.buffer)
    memory.copyWithin(this.#output, source, source + size)
    if (!this.#exports.mask_alpha_glow(this.#output, this.#width, this.#height, glow)) {
      throw new Error("Artwork mask effects could not process this mask.")
    }
    return new Uint8Array(this.#exports.memory.buffer, this.#output, size)
  }
}
