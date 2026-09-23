import { loadDrawable, throwIfAborted } from "./rendering/assets.js"
import { flattenDrawableLayers, isRasterLayer } from "./rendering/layer-tree.js"
import { MapAssetResolver } from "./asset-resolver.js"
import { applyColorPreset } from "./color-grading.js"

import type {
  CardTemplate,
  CardTemplateBundle,
  ColorPresetCollection,
  PreparedTexturePayload,
  PreparedTextures,
  Region,
  TexturePreparation,
} from "./contracts/index.js"

/**
 * Stable identity of one prepared texture, scoped to one exact template bundle.
 *
 * The preset is identified by name rather than by content because a published change to any part of
 * a template bundle mints a new template version, and a consumer that persists payloads keys them by
 * that exact identity. Naming keeps the lookup a string concatenation on the render path.
 */
export function preparedTextureKey({ assetId, presetName, region }: TexturePreparation) {
  const area = region ? `${region.x},${region.y},${region.width},${region.height}` : "source"
  return `${assetId}\u0000${presetName}\u0000${area}`
}

function texturePreparation(
  assetId: string,
  presetName: string,
  region: Region | undefined,
): TexturePreparation {
  return { assetId, presetName, ...(region ? { region } : {}) }
}

/**
 * Every texture a card of this template can resolve to, derived from the declared layers and
 * presentation rules alone.
 *
 * Explicit user preset overrides are deliberately outside this set: they may name any preset in the
 * collection for any layer, so covering them would multiply the work by the whole collection to
 * prepare textures most cards never show. Those keep grading live, which is what an unprepared
 * render already does.
 */
export function collectTexturePreparations(
  template: CardTemplate,
  colorPresets: ColorPresetCollection,
): readonly TexturePreparation[] {
  const rules = template.presentationRules ?? []
  const preparations: TexturePreparation[] = []
  const seen = new Set<string>()

  for (const layer of flattenDrawableLayers(template.layers)) {
    if (!isRasterLayer(layer)) continue

    const assetIds = new Set<string>()
    if (layer.assetId) assetIds.add(layer.assetId)
    rules.forEach((rule) => {
      const selected = rule.assetSelections?.[layer.id]
      if (selected) assetIds.add(selected)
    })

    const presetNames = new Set<string>()
    if (layer.defaultPreset) presetNames.add(layer.defaultPreset)
    if (layer.presetTarget) {
      const target = layer.presetTarget
      rules.forEach((rule) => {
        const name = rule.presets?.[target]
        if (name) presetNames.add(name)
      })
    }

    for (const assetId of assetIds) {
      for (const presetName of presetNames) {
        // An identity preset performs no pixel work, and an unknown name is the renderer's error to
        // report against the layer that asked for it.
        const method = colorPresets[presetName]?.method
        if (method === undefined || method === "identity") continue
        const preparation = texturePreparation(assetId, presetName, layer.sourceRegion)
        const key = preparedTextureKey(preparation)
        if (seen.has(key)) continue
        seen.add(key)
        preparations.push(preparation)
      }
    }
  }

  return preparations
}

function createCanvas(width: number, height: number, readback = false) {
  if (typeof document === "undefined") {
    throw new Error("Preparing textures requires a browser-compatible document and canvas.")
  }
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d", { willReadFrequently: readback })
  if (!context) throw new Error("A 2D canvas context is required to prepare a texture.")
  return { canvas, context }
}

function encodePlane(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error("The browser could not encode a prepared texture plane."))
    }, "image/png")
  })
}

/**
 * Writes one opaque plane and encodes it losslessly. The alpha channel is forced opaque so the
 * encoder never has to represent premultiplied color, which is what makes the round trip exact.
 */
async function encodeOpaquePlane(pixels: ImageData) {
  for (let index = 3; index < pixels.data.length; index += 4) pixels.data[index] = 255
  const { canvas, context } = createCanvas(pixels.width, pixels.height)
  context.putImageData(pixels, 0, 0)
  return await encodePlane(canvas)
}

/** Source coverage replicated across the color channels, or undefined when nothing is transparent. */
function coveragePlane(pixels: ImageData) {
  let transparent = false
  for (let index = 3; index < pixels.data.length; index += 4) {
    if (pixels.data[index] !== 255) {
      transparent = true
      break
    }
  }
  if (!transparent) return undefined
  const coverage = new ImageData(pixels.width, pixels.height)
  for (let index = 0; index < pixels.data.length; index += 4) {
    const alpha = pixels.data[index + 3]!
    coverage.data[index] = alpha
    coverage.data[index + 1] = alpha
    coverage.data[index + 2] = alpha
    coverage.data[index + 3] = 255
  }
  return coverage
}

async function gradeTexture(
  assets: MapAssetResolver,
  colorPresets: ColorPresetCollection,
  preparation: TexturePreparation,
  signal?: AbortSignal,
): Promise<PreparedTexturePayload> {
  const preset = colorPresets[preparation.presetName]
  if (!preset) {
    throw new Error(`Unknown color preset "${preparation.presetName}".`)
  }
  const drawable = await loadDrawable(assets.resolve(preparation.assetId), signal)
  throwIfAborted(signal)
  const source = drawable as {
    height: number
    naturalHeight?: number
    naturalWidth?: number
    width: number
  }
  const region = preparation.region ?? {
    x: 0,
    y: 0,
    width: source.naturalWidth ?? source.width,
    height: source.naturalHeight ?? source.height,
  }

  const { context } = createCanvas(region.width, region.height, true)
  context.drawImage(
    drawable,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    region.width,
    region.height,
  )
  const pixels = context.getImageData(0, 0, region.width, region.height)
  // Taken before grading so the separation does not depend on grading leaving alpha alone, even
  // though it does.
  const coverage = coveragePlane(pixels)
  // The CPU evaluator, not the accelerated path: it is the byte-order reference implementation, so
  // a persisted texture stays reproducible on a machine whose GPU path is unavailable or rounds a
  // partially covered edge pixel differently.
  applyColorPreset(pixels, preset)

  return {
    key: preparedTextureKey(preparation),
    width: region.width,
    height: region.height,
    color: await encodeOpaquePlane(pixels),
    ...(coverage ? { alpha: await encodeOpaquePlane(coverage) } : {}),
  }
}

export interface PrepareTemplateTexturesOptions {
  /** Reports finished textures against the total, so a caller can show determinate progress. */
  readonly onProgress?: ((completed: number, total: number) => void) | undefined
  readonly signal?: AbortSignal | undefined
}

export interface PreparedTemplateTextures {
  /** Stored as-is by a consumer that wants later sessions to skip the grading entirely. */
  readonly payloads: readonly PreparedTexturePayload[]
  readonly textures: PreparedTextures
}

/**
 * Grades every texture this template can resolve to, once.
 *
 * This is the whole cost of "color matching" paid up front, in exchange for never paying it on a
 * render again. It is deliberately not a cache: a consumer decides where the payloads live and how
 * long they survive, and core neither stores nor reloads them.
 *
 * The returned textures read back from those same payloads rather than from the canvases the
 * grading produced, so a freshly prepared template and one restored from storage draw pixels that
 * came through exactly one code path.
 */
export async function prepareTemplateTextures(
  bundle: CardTemplateBundle,
  options: PrepareTemplateTexturesOptions = {},
): Promise<PreparedTemplateTextures> {
  const preparations = collectTexturePreparations(bundle.template, bundle.colorPresets)
  const assets = new MapAssetResolver(bundle.assets)
  const payloads: PreparedTexturePayload[] = []
  options.onProgress?.(0, preparations.length)
  for (const preparation of preparations) {
    throwIfAborted(options.signal)
    payloads.push(await gradeTexture(assets, bundle.colorPresets, preparation, options.signal))
    options.onProgress?.(payloads.length, preparations.length)
  }
  return { payloads, textures: decodePreparedTextures(payloads) }
}

async function decodePlane(blob: Blob, width: number, height: number) {
  const drawable =
    typeof createImageBitmap === "function"
      ? // Keep the decoder's own color management out of it: the stored bytes are already the exact
        // values the renderer must draw.
        await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" })
      : await loadDrawable(blob)
  try {
    const { context } = createCanvas(width, height, true)
    context.drawImage(drawable, 0, 0)
    return context.getImageData(0, 0, width, height)
  } finally {
    if (typeof ImageBitmap !== "undefined" && drawable instanceof ImageBitmap) drawable.close()
  }
}

/**
 * Rebuilds one texture from its stored planes.
 *
 * Recombining them through `putImageData` is what makes a restored texture identical to a live
 * graded one: both hand the canvas the same unpremultiplied pixels, so neither depends on how the
 * canvas happens to store premultiplied color.
 */
async function decodePreparedTexture(payload: PreparedTexturePayload) {
  const pixels = await decodePlane(payload.color, payload.width, payload.height)
  if (payload.alpha) {
    const coverage = await decodePlane(payload.alpha, payload.width, payload.height)
    for (let index = 0; index < pixels.data.length; index += 4) {
      pixels.data[index + 3] = coverage.data[index]!
    }
  }
  const { canvas, context } = createCanvas(payload.width, payload.height)
  context.putImageData(pixels, 0, 0)
  return canvas
}

/**
 * Prepared textures backed by stored payloads, each decoded once and only when a render first draws
 * it. A payload that cannot be decoded resolves to undefined so that render grades it live instead
 * of failing on a damaged cache.
 */
export function decodePreparedTextures(
  payloads: readonly PreparedTexturePayload[],
): PreparedTextures {
  const byKey = new Map(payloads.map((payload) => [payload.key, payload]))
  const decoded = new Map<string, Promise<CanvasImageSource | undefined>>()
  return {
    get(key: string) {
      const payload = byKey.get(key)
      if (!payload) return undefined
      let pending = decoded.get(key)
      if (!pending) {
        pending = decodePreparedTexture(payload).catch(() => undefined)
        decoded.set(key, pending)
      }
      return pending
    },
  }
}
