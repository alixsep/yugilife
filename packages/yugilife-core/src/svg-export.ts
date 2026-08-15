import { validateSvgElementDefinition } from "./validation.js"

import type {
  CardTemplate,
  RasterRenderSegment,
  RenderSegment,
  SvgElementDefinition,
  SvgExportOptions,
  SvgTextMode,
} from "./contracts/index.js"

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

export function serializeSvgElement(element: SvgElementDefinition): string {
  validateSvgElementDefinition(element)
  const attributes = Object.entries(element.attributes ?? {})
    .map(([name, value]) => ` ${name}="${escapeXml(String(value))}"`)
    .join("")
  const content = [
    element.text === undefined ? "" : escapeXml(element.text),
    ...(element.children ?? []).map(serializeSvgElement),
  ].join("")
  return `<${element.tag}${attributes}>${content}</${element.tag}>`
}

export function assertSvgTextMode(value: unknown): asserts value is SvgTextMode {
  if (value !== "paths" && value !== "text") {
    throw new Error(`Unsupported SVG text mode "${String(value)}". Expected "paths" or "text".`)
  }
}

function containsText(element: SvgElementDefinition): boolean {
  return (
    element.tag === "text" ||
    element.tag === "tspan" ||
    Boolean(element.children?.some(containsText))
  )
}

function flattenRasterRun(
  template: CardTemplate,
  canvases: readonly HTMLCanvasElement[],
): RasterRenderSegment {
  const { width, height } = template.dimensions
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) throw new Error("A 2D canvas context is required to flatten SVG raster export.")
  context.globalCompositeOperation = "source-over"
  canvases.forEach((source) => context.drawImage(source, 0, 0, width, height))
  return { canvas, kind: "raster" }
}

/**
 * Flattens only contiguous raster runs for export. Mask isolation may split one ordered raster
 * run into several full-card canvases; source-over compositing restores that run as one PNG without
 * moving raster content across a vector segment.
 */
function flattenRasterSegments(
  template: CardTemplate,
  renderSegments: readonly RenderSegment[],
): readonly RenderSegment[] {
  const flattened: RenderSegment[] = []
  let rasterRun: HTMLCanvasElement[] = []

  const flushRasterRun = () => {
    const first = rasterRun[0]
    if (rasterRun.length === 1 && first) {
      flattened.push({ canvas: first, kind: "raster" })
    } else if (rasterRun.length > 1) {
      flattened.push(flattenRasterRun(template, rasterRun))
    }
    rasterRun = []
  }

  renderSegments.forEach((segment) => {
    if (segment.kind === "raster") {
      rasterRun.push(segment.canvas)
      return
    }
    flushRasterRun()
    flattened.push(segment)
  })
  flushRasterRun()
  return flattened
}

export function serializeCardSvg(
  template: CardTemplate,
  renderSegments: readonly RenderSegment[],
  options: SvgExportOptions = {},
) {
  const fontSmoothing = options.fontSmoothing ?? "grayscale"
  const fontSmoothingStyle =
    fontSmoothing === "grayscale"
      ? "-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale"
      : "-webkit-font-smoothing: subpixel-antialiased; -moz-osx-font-smoothing: auto"
  const textMode: unknown = options.textMode ?? "paths"
  assertSvgTextMode(textMode)
  if (
    textMode === "paths" &&
    renderSegments.some(
      (segment) => segment.kind === "vector" && segment.elements.some(containsText),
    )
  ) {
    throw new Error(
      'SVG text mode "paths" cannot serialize residual <text> or <tspan> elements. Use exportCardToSvg so fonts can be loaded and outlined asynchronously.',
    )
  }
  const { width, height } = template.dimensions
  const title = options.title ? `<title>${escapeXml(options.title)}</title>` : ""
  const content = flattenRasterSegments(template, renderSegments)
    .map((segment) => {
      if (segment.kind === "vector") return segment.elements.map(serializeSvgElement).join("")
      // Raster planes are transparent intermediates, so SVG embeds each flattened run losslessly as
      // PNG. Raster runs separated by vector content remain separate to preserve layer order.
      const image = segment.canvas.toDataURL("image/png")
      return `<image href="${escapeXml(image)}" x="0" y="0" width="${width}" height="${height}"/>`
    })
    .join("")
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-yugilife-text-mode="${textMode}" style="${fontSmoothingStyle}">`,
    title,
    content,
    "</svg>",
  ].join("")
}
