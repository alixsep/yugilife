import { rasterizeCardSvgToImage } from "../raster-export.js"
import { serializeCardSvg, serializeSvgElement } from "../svg-export.js"

import { loadDrawable, throwIfAborted } from "./assets.js"

import type {
  CardDimensions,
  CardTemplate,
  Region,
  RenderedElementAlphaChannel,
  RenderedElementManifestEntry,
  RenderManifest,
  SvgElementDefinition,
} from "../contracts/index.js"

export interface CapturedRenderedElement {
  readonly canvas?: HTMLCanvasElement | undefined
  readonly elements?: readonly SvgElementDefinition[] | undefined
  readonly kind: "image" | "svg"
  readonly layerId: string
  readonly order: number
  readonly sourceFields: readonly string[]
}

interface PreparedCoverage extends CapturedRenderedElement {
  readonly alpha: Uint8ClampedArray
  readonly outlinedElements?: readonly SvgElementDefinition[] | undefined
}

function canvasContext(canvas: HTMLCanvasElement, readFrequently = false) {
  const context = canvas.getContext("2d", readFrequently ? { willReadFrequently: true } : undefined)
  if (!context) throw new Error("A 2D canvas context is required to prepare render coverage.")
  return context
}

function alphaFromCanvas(canvas: HTMLCanvasElement, dimensions: CardDimensions) {
  const context = canvasContext(canvas, true)
  const pixels = context.getImageData(0, 0, dimensions.width, dimensions.height).data
  const alpha = new Uint8ClampedArray(dimensions.width * dimensions.height)
  for (let pixel = 0; pixel < alpha.length; pixel += 1) alpha[pixel] = pixels[pixel * 4 + 3] ?? 0
  return alpha
}

function whiteAlphaCanvas(alpha: Uint8ClampedArray, dimensions: CardDimensions) {
  const canvas = document.createElement("canvas")
  canvas.width = dimensions.width
  canvas.height = dimensions.height
  const context = canvasContext(canvas)
  const image = context.createImageData(dimensions.width, dimensions.height)
  for (let pixel = 0; pixel < alpha.length; pixel += 1) {
    const offset = pixel * 4
    image.data[offset] = 255
    image.data[offset + 1] = 255
    image.data[offset + 2] = 255
    image.data[offset + 3] = alpha[pixel] ?? 0
  }
  context.putImageData(image, 0, 0)
  return canvas
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error("The browser could not encode a rendered alpha channel as PNG."))
    }, "image/png")
  })
}

function alphaBounds(alpha: Uint8ClampedArray, dimensions: CardDimensions): Region | undefined {
  let minimumX = dimensions.width
  let minimumY = dimensions.height
  let maximumX = -1
  let maximumY = -1
  for (let y = 0; y < dimensions.height; y += 1) {
    for (let x = 0; x < dimensions.width; x += 1) {
      if ((alpha[y * dimensions.width + x] ?? 0) === 0) continue
      minimumX = Math.min(minimumX, x)
      minimumY = Math.min(minimumY, y)
      maximumX = Math.max(maximumX, x)
      maximumY = Math.max(maximumY, y)
    }
  }
  if (maximumX < minimumX || maximumY < minimumY) return undefined
  return {
    height: maximumY - minimumY + 1,
    width: maximumX - minimumX + 1,
    x: minimumX,
    y: minimumY,
  }
}

async function vectorCoverage(
  capture: CapturedRenderedElement,
  template: CardTemplate,
  outline: (elements: readonly SvgElementDefinition[]) => Promise<readonly SvgElementDefinition[]>,
  signal?: AbortSignal,
): Promise<PreparedCoverage> {
  const elements = capture.elements ?? []
  const outlinedElements = await outline(elements)
  throwIfAborted(signal)
  const svg = serializeCardSvg(template, [{ elements: outlinedElements, kind: "vector" }], {
    textMode: "paths",
  })
  const blob = await rasterizeCardSvgToImage(svg, template.dimensions, { format: "png" }, signal)
  const drawable = await loadDrawable(blob, signal)
  const canvas = document.createElement("canvas")
  canvas.width = template.dimensions.width
  canvas.height = template.dimensions.height
  canvasContext(canvas).drawImage(drawable, 0, 0)
  return {
    ...capture,
    alpha: alphaFromCanvas(canvas, template.dimensions),
    outlinedElements,
  }
}

function vectorAlphaSvg(
  elements: readonly SvgElementDefinition[],
  dimensions: CardDimensions,
  unoccluded?: Uint8ClampedArray,
) {
  const source = elements.map(serializeSvgElement).join("")
  const visibility = unoccluded
    ? whiteAlphaCanvas(unoccluded, dimensions).toDataURL("image/png")
    : undefined
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.width}" height="${dimensions.height}" viewBox="0 0 ${dimensions.width} ${dimensions.height}">`,
    '<defs><mask id="source" mask-type="alpha" style="mask-type:alpha">',
    source,
    "</mask>",
    visibility
      ? '<mask id="visible" mask-type="alpha" style="mask-type:alpha">' +
        `<image href="${visibility}" x="0" y="0" width="${dimensions.width}" height="${dimensions.height}"/>` +
        "</mask>"
      : "",
    "</defs>",
    visibility ? '<g mask="url(#visible)">' : "<g>",
    `<rect width="${dimensions.width}" height="${dimensions.height}" fill="#fff" mask="url(#source)"/>`,
    "</g>",
    "</svg>",
  ].join("")
}

function alphaChannel(
  alpha: Uint8ClampedArray,
  kind: CapturedRenderedElement["kind"],
  outlinedElements: readonly SvgElementDefinition[],
  dimensions: CardDimensions,
  vectorOcclusion?: Uint8ClampedArray,
): RenderedElementAlphaChannel {
  return Object.freeze({
    alphaAt(x: number, y: number) {
      const pixelX = Math.floor(x)
      const pixelY = Math.floor(y)
      if (pixelX < 0 || pixelY < 0 || pixelX >= dimensions.width || pixelY >= dimensions.height) {
        return 0
      }
      return alpha[pixelY * dimensions.width + pixelX] ?? 0
    },
    kind,
    mimeType: kind === "svg" ? "image/svg+xml" : "image/png",
    async toBlob() {
      if (kind === "svg") {
        return new Blob([vectorAlphaSvg(outlinedElements, dimensions, vectorOcclusion)], {
          type: "image/svg+xml",
        })
      }
      return await canvasBlob(whiteAlphaCanvas(alpha, dimensions))
    },
  })
}

/** Builds exact per-layer final-visible alpha without changing the card's coalesced render planes. */
export async function createRenderManifest(
  captures: readonly CapturedRenderedElement[],
  template: CardTemplate,
  outline: (elements: readonly SvgElementDefinition[]) => Promise<readonly SvgElementDefinition[]>,
  signal?: AbortSignal,
): Promise<RenderManifest> {
  const prepared: PreparedCoverage[] = []
  for (const capture of captures) {
    throwIfAborted(signal)
    if (capture.kind === "image") {
      if (!capture.canvas) continue
      prepared.push({
        ...capture,
        alpha: alphaFromCanvas(capture.canvas, template.dimensions),
      })
    } else {
      prepared.push(await vectorCoverage(capture, template, outline, signal))
    }
  }

  const pixelCount = template.dimensions.width * template.dimensions.height
  const occlusion = new Uint8ClampedArray(pixelCount)
  const entries: RenderedElementManifestEntry[] = []
  for (let index = prepared.length - 1; index >= 0; index -= 1) {
    const element = prepared[index]
    if (!element) continue
    const visible = new Uint8ClampedArray(pixelCount)
    const unoccluded = new Uint8ClampedArray(pixelCount)
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const sourceAlpha = element.alpha[pixel] ?? 0
      const aboveAlpha = occlusion[pixel] ?? 0
      const remaining = 255 - aboveAlpha
      unoccluded[pixel] = remaining
      visible[pixel] = Math.round((sourceAlpha * remaining) / 255)
      occlusion[pixel] = Math.round(sourceAlpha + (aboveAlpha * (255 - sourceAlpha)) / 255)
    }
    const bounds = alphaBounds(visible, template.dimensions)
    const absoluteBounds = alphaBounds(element.alpha, template.dimensions)
    const finalAlpha = visible
    const kind = element.kind
    const outlinedElements = element.outlinedElements ?? []
    entries.push(
      Object.freeze({
        absoluteAlpha: alphaChannel(element.alpha, kind, outlinedElements, template.dimensions),
        absoluteBounds: absoluteBounds ? Object.freeze(absoluteBounds) : undefined,
        alpha: alphaChannel(finalAlpha, kind, outlinedElements, template.dimensions, unoccluded),
        bounds: bounds ? Object.freeze(bounds) : undefined,
        layerId: element.layerId,
        order: element.order,
        sourceFields: Object.freeze([...element.sourceFields]),
      }),
    )
  }
  entries.reverse()
  return Object.freeze({ elements: Object.freeze(entries) })
}
