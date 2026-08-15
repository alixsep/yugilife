import { MapAssetResolver } from "../asset-resolver.js"
import { resolveCardPresentation } from "../presentation.js"
import { rasterizeCardSvgToImage } from "../raster-export.js"
import { deriveCardSemantics } from "../semantics.js"
import { assertSvgTextMode, serializeCardSvg } from "../svg-export.js"
import {
  validateCardData,
  validateCardTemplate,
  validateSvgElementDefinition,
} from "../validation.js"

import { loadPresentationFonts, throwIfAborted } from "./assets.js"
import { applyCanvasMask } from "./canvas-masks.js"
import { createDefaultLayerRenderers } from "./default-renderers.js"
import { assertLayerTree, findRenderer, isLayerVisible, rendererKey } from "./layers.js"
import { outlineSvgText } from "./text-outlines.js"

export { resolveRasterOutputDimensions } from "../raster-export.js"
export { createDefaultLayerRenderers } from "./default-renderers.js"

import type {
  CardData,
  LayerDefinition,
  PngCardExportOptions,
  RasterCardExportOptions,
  RenderedCard,
  RenderLayerContext,
  RenderOptions,
  RenderSegment,
  SvgCardExportOptions,
  SvgElementDefinition,
} from "../contracts/index.js"

export async function renderCard(card: CardData, options: RenderOptions): Promise<RenderedCard> {
  if (typeof document === "undefined") {
    throw new Error("renderCard requires a browser-compatible document and canvas implementation.")
  }
  throwIfAborted(options.signal)
  const template = validateCardTemplate(options.templateBundle.template)
  validateCardData(card, template)
  const semantics = deriveCardSemantics(card, template)
  const presentation = resolveCardPresentation(template, semantics, options.presentationOverrides)
  const assets = new MapAssetResolver(options.templateBundle.assets, options.assets)
  const colorPresets = options.templateBundle.colorPresets
  const renderers = { ...createDefaultLayerRenderers(), ...options.layerRenderers }
  assertLayerTree(
    template.layers,
    renderers,
    assets,
    presentation.assetSelections,
    presentation.layerMasks,
    template.masks,
  )
  await loadPresentationFonts(presentation, assets, options.signal)
  throwIfAborted(options.signal)

  function createRasterCanvas() {
    const canvas = document.createElement("canvas")
    canvas.width = template.dimensions.width
    canvas.height = template.dimensions.height
    const context = canvas.getContext("2d", { willReadFrequently: true })
    if (!context) throw new Error("A 2D canvas context is required to render a card.")
    return { canvas, context }
  }
  let raster = createRasterCanvas()
  let rasterDirty = false
  const renderSegments: RenderSegment[] = []
  const vectorLayers: SvgElementDefinition[] = []
  const richTextWarnings: RenderLayerContext["richTextWarnings"] = []
  const visibility = { ...presentation.layerVisibility, ...(options.layers ?? {}) }
  const presetOverrides = { ...presentation.presets, ...(options.presetOverrides ?? {}) }

  function applyPresentationLayerOptions(layer: LayerDefinition): LayerDefinition {
    const patch = presentation.layerOptions[layer.id]
    if (!patch || (layer.kind !== "raster" && layer.kind !== "canvas")) return layer
    return {
      ...layer,
      options: { ...(layer.options ?? {}), ...patch },
    }
  }

  function applyPresentationLayerRegion(layer: LayerDefinition): LayerDefinition {
    const region = presentation.layerRegions[layer.id]
    if (!region || !("region" in layer)) return layer
    return { ...layer, region }
  }

  function appendVectorSegment(elements: readonly SvgElementDefinition[]) {
    if (elements.length === 0) return
    const previous = renderSegments.at(-1)
    if (previous?.kind === "vector") {
      renderSegments[renderSegments.length - 1] = Object.freeze({
        elements: Object.freeze([...previous.elements, ...elements]),
        kind: "vector" as const,
      })
    } else {
      renderSegments.push(
        Object.freeze({
          elements: Object.freeze([...elements]),
          kind: "vector" as const,
        }),
      )
    }
  }

  function flushRasterSegment(prepareNext = true) {
    if (!rasterDirty) return
    renderSegments.push(Object.freeze({ canvas: raster.canvas, kind: "raster" as const }))
    if (prepareNext) {
      raster = createRasterCanvas()
      renderContext.context = raster.context
    }
    rasterDirty = false
  }

  async function renderLayer(layer: LayerDefinition) {
    throwIfAborted(options.signal)
    const resolvedLayer = applyPresentationLayerOptions(applyPresentationLayerRegion(layer))
    if (!isLayerVisible(resolvedLayer, visibility)) return
    const renderer = findRenderer(renderers, rendererKey(resolvedLayer))
    if (!renderer) throw new Error(`Unknown renderer for layer "${resolvedLayer.id}".`)
    const mask = presentation.layerMasks[resolvedLayer.id]
    const maskedRasterGroup =
      mask && resolvedLayer.kind === "group" && renderer.output === "container"
    if (mask && renderer.output !== "raster" && !maskedRasterGroup) {
      throw new Error(
        `Canvas mask "${mask.id}" can only target raster-output layer "${resolvedLayer.id}".`,
      )
    }
    const vectorStart = vectorLayers.length
    let isolatedRaster: ReturnType<typeof createRasterCanvas> | undefined
    let destinationContext: CanvasRenderingContext2D | undefined
    if (mask) {
      destinationContext = renderContext.context
      isolatedRaster = createRasterCanvas()
      renderContext.context = isolatedRaster.context
    }
    let rendered: boolean | void
    try {
      rendered = await renderer.render(renderContext, resolvedLayer)
    } catch (error) {
      throwIfAborted(options.signal)
      throw error
    } finally {
      if (destinationContext) renderContext.context = destinationContext
    }
    const emittedVectors = vectorLayers.slice(vectorStart)
    if (renderer.output === "raster") {
      if (emittedVectors.length > 0) {
        throw new Error(
          `Raster renderer for layer "${layer.id}" emitted vector output. Split mixed output into separate ordered layers.`,
        )
      }
      if (rendered !== false) {
        if (mask && isolatedRaster) {
          await applyCanvasMask(
            isolatedRaster.canvas,
            assets,
            mask,
            template.dimensions,
            options.signal,
          )
          // The isolated surface is only needed while multiplying this layer's alpha. Merge it
          // back into the active raster run now so preview and export do not retain and later
          // recompose one full-card canvas per masked layer.
          if (!destinationContext) {
            throw new Error(`Masked layer "${layer.id}" lost its destination canvas.`)
          }
          destinationContext.drawImage(isolatedRaster.canvas, 0, 0)
          rasterDirty = true
        } else {
          rasterDirty = true
        }
      }
    } else if (renderer.output === "container") {
      if (mask && emittedVectors.length > 0) {
        throw new Error(
          `Masked container layer "${layer.id}" emitted vector output. Split mixed output into separate ordered layers.`,
        )
      }
      if (mask && isolatedRaster) {
        await applyCanvasMask(
          isolatedRaster.canvas,
          assets,
          mask,
          template.dimensions,
          options.signal,
        )
        if (!destinationContext) {
          throw new Error(`Masked group "${layer.id}" lost its destination canvas.`)
        }
        destinationContext.drawImage(isolatedRaster.canvas, 0, 0)
        rasterDirty = true
      }
    } else if (renderer.output === "vector") {
      if (emittedVectors.length > 0) flushRasterSegment()
      appendVectorSegment(emittedVectors)
    }
    throwIfAborted(options.signal)
  }
  const renderContext: RenderLayerContext = {
    assets,
    assetSelections: presentation.assetSelections,
    card,
    colorPresets,
    context: raster.context,
    layerVisibility: visibility,
    presetOverrides,
    presentation,
    richTextWarnings,
    renderLayer,
    signal: options.signal,
    template,
    vectorLayers,
  }

  for (const layer of template.layers) await renderLayer(layer)
  flushRasterSegment(false)
  throwIfAborted(options.signal)
  vectorLayers.forEach((element, index) =>
    validateSvgElementDefinition(element, `Rendered vector layer ${index}`),
  )
  throwIfAborted(options.signal)
  const completedSegments = Object.freeze([...renderSegments])
  const completedVectorLayers = Object.freeze([...vectorLayers])
  const completedWarnings = Object.freeze([...richTextWarnings])

  const toSvg: RenderedCard["toSvg"] = async (exportOptions) => {
    const requestedMode: unknown = exportOptions?.textMode ?? "paths"
    assertSvgTextMode(requestedMode)
    if (requestedMode === "text") {
      return serializeCardSvg(template, completedSegments, {
        ...exportOptions,
        textMode: requestedMode,
      })
    }
    const exportSegments: RenderSegment[] = []
    for (const segment of completedSegments) {
      if (segment.kind === "raster") {
        exportSegments.push(segment)
        continue
      }
      const elements = await outlineSvgText(
        segment.elements,
        template.dimensions,
        presentation,
        assets,
        options.signal,
      )
      exportSegments.push(
        Object.freeze({ elements: Object.freeze([...elements]), kind: "vector" as const }),
      )
    }
    throwIfAborted(options.signal)
    return serializeCardSvg(template, exportSegments, {
      ...exportOptions,
      textMode: requestedMode,
    })
  }

  async function toImage(exportOptions?: Parameters<RenderedCard["toImage"]>[0]) {
    const svg = await toSvg()
    throwIfAborted(options.signal)
    return await rasterizeCardSvgToImage(svg, template.dimensions, exportOptions, options.signal)
  }

  return {
    presentation,
    renderSegments: completedSegments,
    warnings: completedWarnings,
    template,
    toImage,
    async toPng(exportOptions) {
      return await toImage({
        format: "png",
        ...(exportOptions?.scale === undefined ? {} : { size: { scale: exportOptions.scale } }),
      })
    },
    toSvg,
    vectorLayers: completedVectorLayers,
  }
}

export async function exportCardToImage(card: CardData, options: RasterCardExportOptions) {
  const { backgroundColor, format, quality, size, ...renderOptions } = options
  const rendered = await renderCard(card, renderOptions)
  return await rendered.toImage({ backgroundColor, format, quality, size })
}

export async function exportCardToPng(card: CardData, options: PngCardExportOptions) {
  const { scale, ...renderOptions } = options
  const rendered = await renderCard(card, renderOptions)
  return await rendered.toPng({ scale })
}

export async function exportCardToSvg(card: CardData, options: SvgCardExportOptions) {
  const { fontSmoothing, textMode, title, ...renderOptions } = options
  const resolvedTextMode: unknown = textMode ?? "paths"
  assertSvgTextMode(resolvedTextMode)
  const rendered = await renderCard(card, renderOptions)
  return await rendered.toSvg({ fontSmoothing, textMode: resolvedTextMode, title })
}
