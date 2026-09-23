import { loadDrawable, throwIfAborted } from "./assets.js"

import type {
  AssetResolver,
  AssetSource,
  CardDimensions,
  ResolvedLayerMask,
} from "../contracts/index.js"

const MAX_STRING_MASK_CACHE_ENTRIES = 32
const preparedMaskObjectCaches = new WeakMap<object, Map<string, Promise<HTMLCanvasElement>>>()
const preparedMaskStringCache = new Map<string, Promise<HTMLCanvasElement>>()
const scopedMaskCaches = new WeakMap<
  HTMLCanvasElement,
  WeakMap<HTMLCanvasElement, HTMLCanvasElement>
>()

function abortError() {
  return new DOMException("Rendering was aborted.", "AbortError")
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : abortError()
}

async function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal)
  if (!signal) return promise
  return await new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortReason(signal))
    signal.addEventListener("abort", abort, { once: true })
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

function boundedGet<T>(cache: Map<string, T>, key: string) {
  const value = cache.get(key)
  if (value !== undefined) {
    cache.delete(key)
    cache.set(key, value)
  }
  return value
}

function boundedSet<T>(cache: Map<string, T>, key: string, value: T, maximum: number) {
  cache.set(key, value)
  if (cache.size > maximum) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

function sourceCacheKey(source: string | URL) {
  const value = source instanceof URL ? source.href : source
  try {
    return new URL(value, typeof document === "undefined" ? undefined : document.baseURI).href
  } catch {
    return value
  }
}

function maskCacheKey(mask: ResolvedLayerMask, dimensions: CardDimensions) {
  return `${dimensions.width}x${dimensions.height}\u0000${mask.channel}\u0000${mask.invert ? "1" : "0"}`
}

function objectCache(source: object) {
  let cache = preparedMaskObjectCaches.get(source)
  if (!cache) {
    cache = new Map()
    preparedMaskObjectCaches.set(source, cache)
  }
  return cache
}

function coverageFromLuminance(red: number, green: number, blue: number) {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

/** Scopes only a mask's attenuation from opaque to the alpha coverage of another layer. */
export function scopeMaskAlpha(maskAlpha: number, coverageAlpha: number) {
  return 255 - Math.round((coverageAlpha * (255 - maskAlpha)) / 255)
}

/**
 * Memoizes one scoped mask per (coverage surface, prepared mask) pair.
 *
 * The coverage canvas is a live drawing surface, so this result is only reusable once that layer
 * has finished rendering. Template validation guarantees that: a mask may only name a coverage
 * layer that renders strictly before every layer the mask targets (see `assertLayerTree` and
 * `validateCardTemplateShape`), so the surface is complete before the first scoped read and cannot
 * change afterwards. Relaxing that ordering rule invalidates this cache.
 */
function scopeMaskToCoverage(
  prepared: HTMLCanvasElement,
  coverageCanvas: HTMLCanvasElement,
  dimensions: CardDimensions,
) {
  let preparedMasks = scopedMaskCaches.get(coverageCanvas)
  if (!preparedMasks) {
    preparedMasks = new WeakMap()
    scopedMaskCaches.set(coverageCanvas, preparedMasks)
  }
  const cached = preparedMasks.get(prepared)
  if (cached) return cached

  const scoped = document.createElement("canvas")
  scoped.width = dimensions.width
  scoped.height = dimensions.height
  const scopedContext = scoped.getContext("2d", { willReadFrequently: true })
  const preparedContext = prepared.getContext("2d", { willReadFrequently: true })
  const coverageContext = coverageCanvas.getContext("2d", { willReadFrequently: true })
  if (!scopedContext || !preparedContext || !coverageContext) {
    throw new Error("A 2D canvas context is required to scope a canvas mask to layer coverage.")
  }
  const preparedPixels = preparedContext.getImageData(0, 0, dimensions.width, dimensions.height)
  const coveragePixels = coverageContext.getImageData(0, 0, dimensions.width, dimensions.height)
  const output = scopedContext.createImageData(dimensions.width, dimensions.height)
  for (let index = 0; index < output.data.length; index += 4) {
    const maskAlpha = preparedPixels.data[index + 3] ?? 0
    const coverageAlpha = coveragePixels.data[index + 3] ?? 0
    const alpha = scopeMaskAlpha(maskAlpha, coverageAlpha)
    output.data[index] = 255
    output.data[index + 1] = 255
    output.data[index + 2] = 255
    output.data[index + 3] = alpha
  }
  scopedContext.putImageData(output, 0, 0)
  preparedMasks.set(prepared, scoped)
  return scoped
}

async function prepareCanvasMask(
  source: AssetSource,
  mask: ResolvedLayerMask,
  dimensions: CardDimensions,
): Promise<HTMLCanvasElement> {
  const drawable = await loadDrawable(source)
  const canvas = document.createElement("canvas")
  canvas.width = dimensions.width
  canvas.height = dimensions.height
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) throw new Error("A 2D canvas context is required to prepare a canvas mask.")
  context.drawImage(drawable, 0, 0, dimensions.width, dimensions.height)

  if (mask.channel === "luminance" || mask.invert) {
    const imageData = context.getImageData(0, 0, dimensions.width, dimensions.height)
    const { data } = imageData
    for (let index = 0; index < data.length; index += 4) {
      const sourceAlpha = data[index + 3] ?? 0
      let alpha = sourceAlpha
      if (mask.channel === "luminance") {
        let coverage = coverageFromLuminance(
          data[index] ?? 0,
          data[index + 1] ?? 0,
          data[index + 2] ?? 0,
        )
        if (mask.invert) coverage = 255 - coverage
        alpha = (coverage * sourceAlpha) / 255
      } else if (mask.invert) {
        alpha = 255 - sourceAlpha
      }
      data[index] = 255
      data[index + 1] = 255
      data[index + 2] = 255
      data[index + 3] = Math.round(alpha)
    }
    context.putImageData(imageData, 0, 0)
  }

  return canvas
}

function cachedMaskPromise(
  source: AssetSource,
  key: string,
): Promise<HTMLCanvasElement> | undefined {
  if (typeof source === "string" || source instanceof URL) {
    return boundedGet(preparedMaskStringCache, `${sourceCacheKey(source)}\u0000${key}`)
  }
  if (typeof source === "object" && source !== null) {
    return objectCache(source).get(key)
  }
  return undefined
}

function cacheMaskPromise(source: AssetSource, key: string, promise: Promise<HTMLCanvasElement>) {
  if (typeof source === "string" || source instanceof URL) {
    boundedSet(
      preparedMaskStringCache,
      `${sourceCacheKey(source)}\u0000${key}`,
      promise,
      MAX_STRING_MASK_CACHE_ENTRIES,
    )
    return
  }
  if (typeof source === "object" && source !== null) objectCache(source).set(key, promise)
}

function evictMaskPromise(source: AssetSource, key: string, promise: Promise<HTMLCanvasElement>) {
  if (typeof source === "string" || source instanceof URL) {
    const cacheKey = `${sourceCacheKey(source)}\u0000${key}`
    if (preparedMaskStringCache.get(cacheKey) === promise) preparedMaskStringCache.delete(cacheKey)
    return
  }
  if (typeof source === "object" && source !== null) {
    const cache = preparedMaskObjectCaches.get(source)
    if (cache?.get(key) === promise) cache.delete(key)
  }
}

async function preparedCanvasMask(
  assets: AssetResolver,
  mask: ResolvedLayerMask,
  dimensions: CardDimensions,
  signal?: AbortSignal,
) {
  const source = assets.resolve(mask.assetId)
  const key = maskCacheKey(mask, dimensions)
  let promise = cachedMaskPromise(source, key)
  if (!promise) {
    promise = prepareCanvasMask(source, mask, dimensions)
    cacheMaskPromise(source, key, promise)
    void promise.catch(() => evictMaskPromise(source, key, promise!))
  }
  return await withAbort(promise, signal)
}

/** Applies a resolved full-card mask to an already isolated raster layer canvas. */
export async function applyCanvasMask(
  canvas: HTMLCanvasElement,
  assets: AssetResolver,
  mask: ResolvedLayerMask,
  dimensions: CardDimensions,
  coverageCanvas?: HTMLCanvasElement,
  signal?: AbortSignal,
) {
  const prepared = await preparedCanvasMask(assets, mask, dimensions, signal)
  throwIfAborted(signal)
  const context = canvas.getContext("2d")
  if (!context) throw new Error("A 2D canvas context is required to apply a canvas mask.")
  let effectiveMask = prepared
  if (mask.coverageLayerId) {
    // A coverage-scoped mask has no effect where its coverage layer painted nothing, because
    // `scopeMaskAlpha` returns a fully opaque mask at zero coverage. An absent coverage surface
    // (the layer was hidden, or emitted nothing) is that same case for every pixel, so skipping
    // the mask is equivalent to applying it — not a missing-input bail-out. This equivalence is a
    // property of `scopeMaskAlpha`; changing that formula must revisit this branch.
    if (!coverageCanvas) return
    effectiveMask = scopeMaskToCoverage(prepared, coverageCanvas, dimensions)
  }
  context.save()
  try {
    context.globalCompositeOperation = "destination-in"
    context.drawImage(effectiveMask, 0, 0, dimensions.width, dimensions.height)
  } finally {
    context.restore()
  }
}
