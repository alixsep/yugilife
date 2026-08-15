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
  signal?: AbortSignal,
) {
  const prepared = await preparedCanvasMask(assets, mask, dimensions, signal)
  throwIfAborted(signal)
  const context = canvas.getContext("2d")
  if (!context) throw new Error("A 2D canvas context is required to apply a canvas mask.")
  context.save()
  try {
    context.globalCompositeOperation = "destination-in"
    context.drawImage(prepared, 0, 0, dimensions.width, dimensions.height)
  } finally {
    context.restore()
  }
}
