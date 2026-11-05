// Rendering: cards render in a Web Worker (see `client`) and produce the same bytes in every
// browser, and the same bytes as the native `yugilife-cli`. WebP output is encoded by the browser
// from pixels the core composed, since there is no Rust WebP encoder for WebAssembly.

import { resolveCardPresentation } from "../presentation"
import { deriveCardSemantics } from "../semantics"

import { assetBytes, assetReference } from "./assets"
import { abortReason, call } from "./client"

import type {
  AssetSource,
  CardData,
  CardRenderWarning,
  CardTemplateBundle,
  PngCardExportOptions,
  PngExportOptions,
  RasterCardExportOptions,
  RasterExportOptions,
  Region,
  RenderedCard,
  RenderedElementAlphaChannel,
  RenderManifest,
  RenderOptions,
  RenderSegment,
  SvgCardExportOptions,
  SvgElementDefinition,
  SvgExportOptions,
} from "../contracts/index.js"
import type { PackFile } from "../core/instance"

interface AssetEntry {
  readonly file: string
  readonly mediaType: string | undefined
}

interface Inputs {
  readonly files: readonly PackFile[]
  readonly header: Readonly<Record<string, unknown>>
}

type SegmentJson =
  | {
      readonly buffer: number
      readonly height: number
      readonly kind: "raster"
      readonly width: number
    }
  | { readonly elements: readonly SvgElementDefinition[]; readonly kind: "vector" }

interface SegmentsOutput {
  readonly outlinedSegments: readonly SegmentJson[]
  readonly segments: readonly SegmentJson[]
  readonly vectorLayers: readonly SvgElementDefinition[]
}

type ImageOutput =
  | { readonly buffer: number; readonly kind: "image"; readonly mimeType: string }
  | {
      readonly buffer: number
      readonly height: number
      readonly kind: "pixels"
      readonly width: number
    }

interface RenderResponse<T> {
  readonly outputs: readonly T[]
  readonly warnings: readonly CardRenderWarning[]
}

interface AlphaJson {
  readonly crop: {
    readonly buffer: number
    readonly height: number
    readonly width: number
    readonly x: number
    readonly y: number
  } | null
  readonly kind: "image" | "svg"
  readonly mimeType: "image/png" | "image/svg+xml"
}

interface ManifestResponse {
  readonly elements: readonly {
    readonly absoluteAlpha: AlphaJson
    readonly absoluteBounds: Region | null
    readonly alpha: AlphaJson
    readonly bounds: Region | null
    readonly layerId: string
    readonly order: number
    readonly sourceFields: readonly string[]
  }[]
}

async function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return await promise
  if (signal.aborted) throw abortReason(signal)
  return await new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortReason(signal))
    signal.addEventListener("abort", abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

const templateKeys = new WeakMap<CardTemplateBundle, Promise<string>>()
const releasedTemplates = new FinalizationRegistry<string>((key) => {
  void call({ op: "dropTemplate", key }).catch(() => undefined)
})
let nextTemplate = 1

/** Loads a template bundle into the core once, keyed by the bundle object. */
function templateKey(bundle: CardTemplateBundle, signal?: AbortSignal) {
  let key = templateKeys.get(bundle)
  if (!key) {
    const created = (async () => {
      const id = `template-${nextTemplate++}`
      const assets: Record<string, AssetEntry> = {}
      const files: PackFile[] = []
      for (const [assetId, source] of Object.entries(bundle.assets)) {
        const { bytes, mediaType } = await assetBytes(source, assetId)
        const file = `template:${assetId}`
        assets[assetId] = { file, mediaType }
        files.push([file, bytes])
      }
      await call(
        {
          assets,
          colorPresets: bundle.colorPresets,
          key: id,
          manifest: bundle.manifest,
          op: "loadTemplate",
          template: bundle.template,
        },
        files,
      )
      releasedTemplates.register(bundle, id)
      return id
    })()
    created.catch(() => templateKeys.delete(bundle))
    templateKeys.set(bundle, created)
    key = created
  }
  return withAbort(key, signal)
}

function isAsset(value: unknown): value is AssetSource {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function renderInputs(card: CardData, options: RenderOptions): Promise<Inputs> {
  const { signal, templateBundle } = options
  const template = await templateKey(templateBundle, signal)
  const imageFields = new Set(
    templateBundle.template.cardFields
      .filter((field) => field.kind === "image")
      .map((field) => field.name),
  )
  const files = new Map<string, ArrayBuffer>()
  const entry = async (source: AssetSource, label: string): Promise<AssetEntry> => {
    const file = assetReference(source)
    const { bytes, mediaType } = await assetBytes(source, label, signal)
    files.set(file, bytes)
    return { file, mediaType }
  }
  const fields: Record<string, unknown> = {}
  const cardAssets: Record<string, AssetEntry> = {}
  for (const [field, value] of Object.entries(card)) {
    if (value === undefined) continue
    if (isAsset(value) || (imageFields.has(field) && typeof value === "string" && value !== "")) {
      cardAssets[field] = await entry(value, field)
    } else {
      fields[field] = value
    }
  }
  const assets: Record<string, AssetEntry> = {}
  for (const [id, source] of Object.entries(options.assets ?? {})) {
    if (source !== undefined) assets[id] = await entry(source, id)
  }
  if (signal?.aborted) throw abortReason(signal)
  return {
    files: [...files],
    header: {
      assets,
      card: fields,
      cardAssets,
      layers: options.layers ?? {},
      presentationOverrides: options.presentationOverrides ?? null,
      presetOverrides: options.presetOverrides ?? {},
      template,
    },
  }
}

function rasterCanvas(buffer: ArrayBuffer, width: number, height: number) {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) throw new Error("A 2D canvas context is required to display a rendered card.")
  context.putImageData(new ImageData(new Uint8ClampedArray(buffer), width, height), 0, 0)
  return canvas
}

function blobFrom(canvas: HTMLCanvasElement, type: string, quality: number | undefined) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob?.type === type) resolve(blob)
        else reject(new Error(`This browser cannot encode ${type} images.`))
      },
      type,
      quality,
    )
  })
}

async function image(inputs: Inputs, options: RasterExportOptions = {}, signal?: AbortSignal) {
  const { backgroundColor, format, quality, size } = options
  const output = { backgroundColor, format, kind: "image", quality, size }
  const { buffers, response } = await call(
    { ...inputs.header, op: "render", outputs: [output] },
    inputs.files,
    signal,
  )
  const [result] = (response as RenderResponse<ImageOutput>).outputs
  if (!result) throw new Error("The WebAssembly core returned no image.")
  const bytes = buffers[result.buffer]
  if (!bytes) throw new Error("The WebAssembly core returned an incomplete image.")
  if (result.kind === "image") return new Blob([bytes], { type: result.mimeType })
  return await blobFrom(
    rasterCanvas(bytes, result.width, result.height),
    "image/webp",
    quality ?? 0.92,
  )
}

async function svg(inputs: Inputs, options: SvgExportOptions = {}, signal?: AbortSignal) {
  const { fontSmoothing, textMode, title } = options
  const output = { fontSmoothing, kind: "svg", textMode, title }
  const { buffers, response } = await call(
    { ...inputs.header, op: "render", outputs: [output] },
    inputs.files,
    signal,
  )
  const [result] = (response as RenderResponse<{ readonly buffer: number }>).outputs
  const bytes = result && buffers[result.buffer]
  if (!bytes) throw new Error("The WebAssembly core returned no SVG.")
  return new TextDecoder().decode(bytes)
}

let nextManifest = 1

function alphaChannel(
  json: AlphaJson,
  buffers: readonly ArrayBuffer[],
  blob: () => Promise<Blob>,
): RenderedElementAlphaChannel {
  const crop = json.crop
  const plane = crop ? new Uint8Array(buffers[crop.buffer] ?? new ArrayBuffer(0)) : undefined
  return {
    alphaAt(x: number, y: number) {
      if (!crop || !plane) return 0
      const column = Math.floor(x) - crop.x
      const row = Math.floor(y) - crop.y
      if (!(column >= 0 && row >= 0 && column < crop.width && row < crop.height)) return 0
      return plane[row * crop.width + column] ?? 0
    },
    kind: json.kind,
    mimeType: json.mimeType,
    toBlob: blob,
  }
}

async function manifest(inputs: Inputs, signal?: AbortSignal): Promise<RenderManifest> {
  let serial = nextManifest++
  const { buffers, response } = await call(
    { ...inputs.header, op: "manifest", serial },
    inputs.files,
    signal,
  )
  const encoded = async (element: number, absolute: boolean): Promise<Blob> => {
    const request = async () => {
      const reply = await call({ absolute, element, op: "manifestAlpha", serial })
      const { buffer, mimeType } = reply.response as { buffer: number; mimeType: string }
      return new Blob([reply.buffers[buffer] ?? new ArrayBuffer(0)], { type: mimeType })
    }
    try {
      return await request()
    } catch {
      // The core keeps only the latest manifest; rebuild this one if another replaced it.
      serial = nextManifest++
      await call({ ...inputs.header, op: "manifest", serial }, inputs.files)
      return await request()
    }
  }
  return {
    elements: (response as ManifestResponse).elements.map((element, index) => ({
      absoluteAlpha: alphaChannel(element.absoluteAlpha, buffers, () => encoded(index, true)),
      absoluteBounds: element.absoluteBounds ?? undefined,
      alpha: alphaChannel(element.alpha, buffers, () => encoded(index, false)),
      bounds: element.bounds ?? undefined,
      layerId: element.layerId,
      order: element.order,
      sourceFields: element.sourceFields,
    })),
  }
}

export async function renderCard(card: CardData, options: RenderOptions): Promise<RenderedCard> {
  const inputs = await renderInputs(card, options)
  const { buffers, response } = await call(
    { ...inputs.header, op: "render", outputs: [{ kind: "segments" }] },
    inputs.files,
    options.signal,
  )
  const { outputs, warnings } = response as RenderResponse<SegmentsOutput>
  const [result] = outputs
  if (!result) throw new Error("The WebAssembly core returned no segments.")
  const canvases = new Map<number, HTMLCanvasElement>()
  const segments = (list: readonly SegmentJson[]): RenderSegment[] =>
    list.map((segment) => {
      if (segment.kind === "vector") return { elements: segment.elements, kind: "vector" }
      let canvas = canvases.get(segment.buffer)
      if (!canvas) {
        canvas = rasterCanvas(
          buffers[segment.buffer] ?? new ArrayBuffer(0),
          segment.width,
          segment.height,
        )
        canvases.set(segment.buffer, canvas)
      }
      return { canvas, kind: "raster" }
    })
  const template = options.templateBundle.template
  let manifestPromise: Promise<RenderManifest> | undefined
  return {
    createRenderManifest() {
      manifestPromise ??= manifest(inputs)
      manifestPromise.catch(() => {
        manifestPromise = undefined
      })
      return manifestPromise
    },
    presentation: resolveCardPresentation(
      template,
      deriveCardSemantics(card, template),
      options.presentationOverrides,
    ),
    renderSegments: segments(result.segments),
    template,
    toImage: (exportOptions?: RasterExportOptions) => image(inputs, exportOptions),
    toOutlinedSegments: () => Promise.resolve(segments(result.outlinedSegments)),
    toPng: ({ scale }: PngExportOptions = {}) =>
      image(inputs, { format: "png", size: scale === undefined ? undefined : { scale } }),
    toSvg: (exportOptions?: SvgExportOptions) => svg(inputs, exportOptions),
    vectorLayers: result.vectorLayers,
    warnings,
  }
}

export async function exportCardToImage(card: CardData, options: RasterCardExportOptions) {
  const { backgroundColor, format, quality, size, ...renderOptions } = options
  const inputs = await renderInputs(card, renderOptions)
  return await image(inputs, { backgroundColor, format, quality, size }, renderOptions.signal)
}

export async function exportCardToPng(card: CardData, options: PngCardExportOptions) {
  const { scale, ...renderOptions } = options
  const inputs = await renderInputs(card, renderOptions)
  return await image(
    inputs,
    { format: "png", size: scale === undefined ? undefined : { scale } },
    renderOptions.signal,
  )
}

export async function exportCardToSvg(card: CardData, options: SvgCardExportOptions) {
  const { fontSmoothing, textMode, title, ...renderOptions } = options
  const inputs = await renderInputs(card, renderOptions)
  return await svg(
    inputs,
    { fontSmoothing, textMode: textMode ?? "paths", title },
    renderOptions.signal,
  )
}
