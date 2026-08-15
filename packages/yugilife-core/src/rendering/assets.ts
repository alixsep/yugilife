import { isTextLayer, textTypographies, walkLayers } from "./layer-tree.js"

import type {
  AssetResolver,
  AssetSource,
  CardTemplate,
  ResolvedCardPresentation,
  TextTypography,
} from "../contracts/index.js"

export type Drawable = Exclude<AssetSource, string | URL | Blob>

const MAX_STRING_IMAGE_CACHE_ENTRIES = 64
const MAX_STRING_FONT_CACHE_ENTRIES = 32
const drawablePromises = new Map<string, Promise<Drawable>>()
const objectDrawablePromises = new WeakMap<object, Promise<Drawable>>()
const fontCaches = new WeakMap<
  object,
  {
    readonly byObject: WeakMap<object, Map<string, Promise<void>>>
    readonly byUrl: Map<string, Promise<void>>
  }
>()

function abortError() {
  return new DOMException("Rendering was aborted.", "AbortError")
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : abortError()
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortReason(signal)
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

export function isDrawable(source: AssetSource): source is Drawable {
  return (
    typeof source !== "string" &&
    !(source instanceof URL) &&
    !(source instanceof Blob) &&
    "width" in source &&
    "height" in source
  )
}

export function isAssetSource(value: unknown): value is AssetSource {
  return (
    typeof value === "string" ||
    value instanceof URL ||
    value instanceof Blob ||
    (typeof value === "object" &&
      value !== null &&
      "width" in value &&
      "height" in value &&
      !Array.isArray(value))
  )
}

function sourceUrl(source: string | URL | Blob) {
  if (typeof source === "string") return { url: source }
  if (source instanceof URL) return { url: source.href }
  const url = URL.createObjectURL(source)
  return { revoke: () => URL.revokeObjectURL(url), url }
}

async function loadUncachedDrawable(source: AssetSource): Promise<Drawable> {
  if (isDrawable(source)) return source
  if (typeof Image === "undefined") {
    throw new Error("Image assets require a browser-compatible Image implementation.")
  }
  const resolved = sourceUrl(source)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.addEventListener("load", () => resolve(image), { once: true })
      image.addEventListener(
        "error",
        () => reject(new Error(`Could not load image asset "${resolved.url}".`)),
        { once: true },
      )
      image.src = resolved.url
    })
  } finally {
    resolved.revoke?.()
  }
}

export async function loadDrawable(source: AssetSource, signal?: AbortSignal): Promise<Drawable> {
  if (isDrawable(source)) return source
  const objectKey = source instanceof Blob ? source : undefined
  const stringKey =
    typeof source === "string" || source instanceof URL ? sourceCacheKey(source) : undefined
  let promise = objectKey
    ? objectDrawablePromises.get(objectKey)
    : stringKey
      ? boundedGet(drawablePromises, stringKey)
      : undefined
  if (!promise) {
    promise = loadUncachedDrawable(source)
    if (objectKey) objectDrawablePromises.set(objectKey, promise)
    if (stringKey) {
      boundedSet(drawablePromises, stringKey, promise, MAX_STRING_IMAGE_CACHE_ENTRIES)
    }
    void promise.catch(() => {
      if (objectKey && objectDrawablePromises.get(objectKey) === promise) {
        objectDrawablePromises.delete(objectKey)
      }
      if (stringKey && drawablePromises.get(stringKey) === promise) {
        drawablePromises.delete(stringKey)
      }
    })
  }
  return await withAbort(promise, signal)
}

function addFont(fonts: Map<string, string>, typography: TextTypography) {
  if (!typography.fontAssetId) return
  const existing = fonts.get(typography.fontFamily)
  if (existing && existing !== typography.fontAssetId) {
    throw new Error(
      `Font family "${typography.fontFamily}" maps to both "${existing}" and "${typography.fontAssetId}".`,
    )
  }
  fonts.set(typography.fontFamily, typography.fontAssetId)
}

async function loadFonts(
  fonts: ReadonlyMap<string, string>,
  assets: AssetResolver,
  signal?: AbortSignal,
) {
  if (fonts.size === 0) return
  if (typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts) {
    throw new Error("Template fonts require browser FontFace and document.fonts support.")
  }
  let caches = fontCaches.get(document.fonts)
  if (!caches) {
    caches = {
      byObject: new WeakMap(),
      byUrl: new Map(),
    }
    fontCaches.set(document.fonts, caches)
  }
  await Promise.all(
    [...fonts].map(async ([family, id]) => {
      const source = assets.resolve(id)
      if (isDrawable(source)) {
        throw new Error(`Font asset "${id}" must resolve to a URL string, URL, or Blob.`)
      }
      let objectCache: Map<string, Promise<void>> | undefined
      if (source instanceof Blob) {
        objectCache = caches.byObject.get(source)
        if (!objectCache) {
          objectCache = new Map()
          caches.byObject.set(source, objectCache)
        }
      }
      const sourceKey = source instanceof Blob ? undefined : sourceCacheKey(source)
      const key = sourceKey ? `${family}\u0000${sourceKey}` : family
      let promise = objectCache ? objectCache.get(key) : boundedGet(caches.byUrl, key)
      if (!promise) {
        promise = (async () => {
          const resolved = sourceUrl(source)
          try {
            const face = new FontFace(family, `url(${JSON.stringify(resolved.url)})`)
            await face.load()
            document.fonts.add(face)
          } finally {
            resolved.revoke?.()
          }
        })()
        if (objectCache) {
          objectCache.set(key, promise)
        } else {
          boundedSet(caches.byUrl, key, promise, MAX_STRING_FONT_CACHE_ENTRIES)
        }
        void promise.catch(() => {
          if (objectCache && objectCache.get(key) === promise) objectCache.delete(key)
          if (caches.byUrl.get(key) === promise) caches.byUrl.delete(key)
        })
      }
      await withAbort(promise, signal)
    }),
  )
}

export async function loadTemplateFonts(
  template: CardTemplate,
  assets: AssetResolver,
  signal?: AbortSignal,
) {
  const fonts = new Map<string, string>()
  walkLayers(template.layers, ({ layer }) => {
    if (!isTextLayer(layer)) return
    textTypographies(layer).forEach((typography) => addFont(fonts, typography))
  })
  await loadFonts(fonts, assets, signal)
}

/** Loads the fonts used after semantic styles and explicit typography overrides are resolved. */
export async function loadPresentationFonts(
  presentation: ResolvedCardPresentation,
  assets: AssetResolver,
  signal?: AbortSignal,
) {
  const fonts = new Map<string, string>()
  Object.values(presentation.text).forEach(({ typography }) => addFont(fonts, typography))
  await loadFonts(fonts, assets, signal)
}
