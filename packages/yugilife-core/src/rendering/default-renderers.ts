import { TextureCache } from "../color-grading.js"
import { graphemeCount } from "../rich-text.js"

import { isAssetSource, loadDrawable } from "./assets.js"
import { childLayers } from "./layer-tree.js"
import { createTextElement } from "./vector.js"

import type {
  ArtworkLayer,
  CanvasLayer,
  ImageLayer,
  LayerRenderer,
  LayerRendererMap,
  RasterLayer,
  RenderLayerContext,
  RepeatedImageLayer,
  SvgLayer,
  TextLayer,
} from "../contracts/index.js"

const textureCaches = new WeakMap<object, TextureCache>()

function textureCache(source: ConstructorParameters<typeof TextureCache>[0]) {
  let cache = textureCaches.get(source)
  if (!cache) {
    cache = new TextureCache(source)
    textureCaches.set(source, cache)
  }
  return cache
}

export function texturePresetKey(name: string, preset: object | undefined) {
  if (!preset) return name
  return `${name}\u0000${JSON.stringify(preset)}`
}

export function measureTextWidth(
  context: CanvasRenderingContext2D,
  text: string,
  typography: TextLayer["typography"],
) {
  context.save()
  context.font = `${typography.fontStyle ?? "normal"} ${typography.fontWeight ?? "normal"} ${typography.fontSize}px ${JSON.stringify(typography.fontFamily)}`
  const width =
    context.measureText(text).width +
    Math.max(0, graphemeCount(text) - 1) * (typography.letterSpacing ?? 0)
  context.restore()
  return width
}

type BevelLayer = Pick<CanvasLayer, "id" | "options" | "region">

function drawBevel(context: CanvasRenderingContext2D, layer: BevelLayer) {
  const options = layer.options
  const thickness = options?.["thickness"]
  if (!thickness || typeof thickness !== "object") {
    throw new Error(`Bevel layer "${layer.id}" is missing options.thickness.`)
  }
  const edge = thickness as Record<string, unknown>
  const top = Number(edge["top"])
  const rightEdge = Number(edge["right"])
  const bottomEdge = Number(edge["bottom"])
  const leftEdge = Number(edge["left"])
  if (![top, rightEdge, bottomEdge, leftEdge].every(Number.isFinite)) {
    throw new Error(`Bevel layer "${layer.id}" has malformed thickness values.`)
  }
  const color = (key: string) => {
    const value = options?.[key]
    if (typeof value !== "string") {
      throw new Error(`Bevel layer "${layer.id}" option "${key}" must be a color string.`)
    }
    return value
  }
  const opacity = (key: string) => {
    const value = options?.[key]
    if (value === undefined) return 1
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Bevel layer "${layer.id}" option "${key}" must be a finite number.`)
    }
    return value
  }
  const { x, y, width, height } = layer.region
  const right = x + width
  const bottom = y + height
  const innerLeft = x + leftEdge
  const innerTop = y + top
  const innerRight = right - rightEdge
  const innerBottom = bottom - bottomEdge
  const fillSide = (
    points: readonly (readonly [number, number])[],
    fill: string,
    opacity: number,
  ) => {
    const first = points[0]
    if (!first) return
    context.beginPath()
    context.moveTo(...first)
    points.slice(1).forEach((point) => context.lineTo(...point))
    context.closePath()
    context.fillStyle = fill
    context.globalAlpha = opacity
    context.fill()
  }
  context.save()
  fillSide(
    [
      [x, y],
      [right, y],
      [innerRight, innerTop],
      [innerLeft, innerTop],
    ],
    color("highlightColor"),
    opacity("highlightOpacity"),
  )
  fillSide(
    [
      [x, y],
      [innerLeft, innerTop],
      [innerLeft, innerBottom],
      [x, bottom],
    ],
    color("highlightColor"),
    opacity("highlightOpacity"),
  )
  fillSide(
    [
      [x, bottom],
      [right, bottom],
      [innerRight, innerBottom],
      [innerLeft, innerBottom],
    ],
    color("shadowColor"),
    opacity("shadowOpacity"),
  )
  fillSide(
    [
      [right, y],
      [right, bottom],
      [innerRight, innerBottom],
      [innerRight, innerTop],
    ],
    color("shadowColor"),
    opacity("shadowOpacity"),
  )
  context.restore()
}

async function renderColorTexture(renderContext: RenderLayerContext, layer: RasterLayer) {
  const {
    assets,
    assetSelections,
    colorPresets,
    context,
    coverageContext,
    presetOverrides,
    signal,
  } = renderContext
  const assetId = assetSelections[layer.id] ?? layer.assetId
  if (!assetId) {
    throw new Error(`Color-texture layer "${layer.id}" requires assetId.`)
  }
  const drawable = await loadDrawable(assets.resolve(assetId), signal)
  const source = layer.sourceRegion ?? {
    x: 0,
    y: 0,
    width: drawable.width,
    height: drawable.height,
  }
  const presetName =
    presetOverrides[layer.id] ??
    (layer.presetTarget ? presetOverrides[layer.presetTarget] : undefined) ??
    layer.defaultPreset
  const preset = presetName ? colorPresets[presetName] : undefined
  if (presetName && !preset) {
    throw new Error(`Layer "${layer.id}" requested unknown color preset "${presetName}".`)
  }
  const processed = textureCache(drawable).get(
    texturePresetKey(presetName ?? "", preset),
    preset,
    source,
  )
  if (!processed) throw new Error(`Layer "${layer.id}" could not prepare its texture.`)
  const { x, y, width, height } = layer.region
  context.drawImage(processed, x, y, width, height)
  coverageContext?.drawImage(processed, x, y, width, height)
}

export function createDefaultLayerRenderers(): LayerRendererMap {
  const image: LayerRenderer<ImageLayer> = {
    output: "raster",
    async render({ assets, assetSelections, context, coverageContext, signal }, layer) {
      const assetId = assetSelections[layer.id] ?? layer.assetId
      const drawable = await loadDrawable(assets.resolve(assetId), signal)
      const { x, y, width, height } = layer.region
      context.drawImage(drawable, x, y, width, height)
      coverageContext?.drawImage(drawable, x, y, width, height)
      return true
    },
  }
  return {
    image,
    "repeated-image": {
      output: "raster",
      async render(
        { assets, assetSelections, card, context, coverageContext, signal },
        definition,
      ) {
        const layer = definition as RepeatedImageLayer
        const value = card[layer.field]
        if (value === undefined || value === "") return false
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
          throw new Error(
            `Repeated-image layer "${layer.id}" requires card field "${layer.field}" to contain a non-negative integer.`,
          )
        }
        if (value === 0) return false
        const assetId = assetSelections[layer.id] ?? layer.assetId
        const drawable = await loadDrawable(assets.resolve(assetId), signal)
        const { x, y, width, height } = layer.region
        for (let index = 0; index < value; index += 1) {
          context.drawImage(
            drawable,
            x + layer.offset.x * index,
            y + layer.offset.y * index,
            width,
            height,
          )
          coverageContext?.drawImage(
            drawable,
            x + layer.offset.x * index,
            y + layer.offset.y * index,
            width,
            height,
          )
        }
        return true
      },
    },
    artwork: {
      output: "raster",
      async render({ card, context, coverageContext, signal }, layer) {
        const artworkLayer = layer as ArtworkLayer
        const source = card[artworkLayer.field]
        if (source === undefined || source === "") return false
        if (!isAssetSource(source)) {
          throw new Error(
            `Artwork layer "${layer.id}" requires card field "${artworkLayer.field}" to contain an AssetSource.`,
          )
        }
        const drawable = await loadDrawable(source, signal)
        const { x, y, width, height } = artworkLayer.region
        if (artworkLayer.fit === "width") {
          const naturalHeight = (width * drawable.height) / drawable.width
          context.save()
          context.beginPath()
          context.rect(x, y, width, height)
          context.clip()
          context.drawImage(drawable, x, y, width, naturalHeight)
          coverageContext?.save()
          coverageContext?.beginPath()
          coverageContext?.rect(x, y, width, height)
          coverageContext?.clip()
          coverageContext?.drawImage(drawable, x, y, width, naturalHeight)
          coverageContext?.restore()
          context.restore()
        } else {
          context.drawImage(drawable, x, y, width, height)
          coverageContext?.drawImage(drawable, x, y, width, height)
        }
        return true
      },
    },
    "color-texture": {
      output: "raster",
      async render(renderContext, definition) {
        await renderColorTexture(renderContext, definition as RasterLayer)
        return true
      },
    },
    "color-texture-bevel": {
      output: "raster",
      async render(renderContext, definition) {
        // Keep the bevel in the same source surface as the texture. A later canvas mask must
        // multiply their combined alpha once, rather than multiplying two separately masked
        // layers at a partially covered mask boundary.
        const layer = definition as RasterLayer
        await renderColorTexture(renderContext, layer)
        drawBevel(renderContext.context, layer)
        if (renderContext.coverageContext) drawBevel(renderContext.coverageContext, layer)
        return true
      },
    },
    bevel: {
      output: "raster",
      render({ context, coverageContext }, layer) {
        drawBevel(context, layer as CanvasLayer)
        if (coverageContext) drawBevel(coverageContext, layer as CanvasLayer)
        return true
      },
    },
    text: {
      output: "vector",
      render({ card, context, presentation, richTextWarnings, vectorLayers }, layer) {
        const resolved = presentation.text[layer.id]
        if (!resolved) throw new Error(`Text layer "${layer.id}" has no resolved presentation.`)
        const textLayer = layer as TextLayer
        vectorLayers.push(
          createTextElement(
            card,
            { ...textLayer, position: resolved.position },
            (text, typography) => measureTextWidth(context, text, typography),
            {
              fitProfileId: resolved.fitProfileId,
              onWarning: (warning) => richTextWarnings.push({ ...warning, layerId: layer.id }),
              semanticValue: resolved.value,
              typography: resolved.typography,
            },
          ),
        )
      },
    },
    svg: {
      output: "vector",
      render({ vectorLayers }, layer) {
        vectorLayers.push((layer as SvgLayer).element)
      },
    },
    group: {
      output: "container",
      async render(renderContext, layer) {
        for (const child of childLayers(layer) ?? []) {
          await renderContext.renderLayer(child)
        }
      },
    },
  }
}
