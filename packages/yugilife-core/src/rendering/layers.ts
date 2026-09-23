import { childLayers, isTextLayer, textTypographies, walkLayers } from "./layer-tree.js"

import type {
  AssetResolver,
  CanvasMask,
  LayerDefinition,
  LayerRenderer,
  LayerRendererMap,
  ResolvedLayerMask,
  SemanticAssetId,
} from "../contracts/index.js"

export { defaultLayerVisibility, flattenLayers, isLayerVisible, walkLayers } from "./layer-tree.js"

export function rendererKey(layer: LayerDefinition) {
  if (
    (layer.kind === "raster" || layer.kind === "canvas") &&
    typeof layer["renderer"] === "string"
  ) {
    return layer["renderer"]
  }
  return layer.kind
}

/**
 * Own-property lookup. A template is semi-trusted input, so an inherited `Object.prototype` key such
 * as `toString` must never resolve to a renderer.
 */
export function findRenderer(renderers: LayerRendererMap, key: string): LayerRenderer | undefined {
  if (!Object.hasOwn(renderers, key)) return undefined
  const renderer = renderers[key]
  return typeof renderer?.render === "function" ? renderer : undefined
}

export function assertLayerTree(
  layers: readonly LayerDefinition[],
  renderers: LayerRendererMap,
  assets: AssetResolver,
  assetSelections: Readonly<Record<string, SemanticAssetId>> = {},
  layerMasks: Readonly<Record<string, ResolvedLayerMask>> = {},
  masks: readonly CanvasMask[] = [],
) {
  const layersById = new Map<string, LayerDefinition>()
  const layerOrder = new Map<string, number>()
  walkLayers(layers, ({ layer }) => {
    layersById.set(layer.id, layer)
    layerOrder.set(layer.id, layerOrder.size)
    const key = rendererKey(layer)
    const renderer = findRenderer(renderers, key)
    if (!renderer) {
      throw new Error(
        `Unknown layer kind or renderer "${key}" on layer "${layer.id}". Register a renderer through RenderOptions.layerRenderers.`,
      )
    }
    if (!["container", "raster", "vector"].includes(renderer.output)) {
      throw new Error(
        `Renderer "${key}" for layer "${layer.id}" must declare output as "raster", "vector", or "container".`,
      )
    }
    if (renderer.output === "container" && layer.kind !== "group") {
      throw new Error(
        `Renderer "${key}" uses the "container" output plane, which is reserved for group layers.`,
      )
    }
    if (layer.kind === "group" && renderer.output !== "container") {
      throw new Error(`Group layer "${layer.id}" must use a renderer with "container" output.`)
    }
    if (
      (layer.kind === "image" || layer.kind === "repeated-image" || layer.kind === "raster") &&
      typeof layer["assetId"] === "string" &&
      !assets.has(layer["assetId"])
    ) {
      throw new Error(`Layer "${layer.id}" has unresolved semantic asset ID "${layer["assetId"]}".`)
    }
    const selectedAssetId = assetSelections[layer.id]
    if (selectedAssetId !== undefined && !assets.has(selectedAssetId)) {
      throw new Error(
        `Layer "${layer.id}" has unresolved selected semantic asset ID "${selectedAssetId}".`,
      )
    }
    if (isTextLayer(layer)) {
      textTypographies(layer).forEach(({ fontAssetId }) => {
        if (fontAssetId && !assets.has(fontAssetId)) {
          throw new Error(`Layer "${layer.id}" has unresolved font asset ID "${fontAssetId}".`)
        }
      })
    }
    if (layer.kind === "group" && !childLayers(layer)) {
      throw new Error(`Group layer "${layer.id}" must declare a layers array.`)
    }
  })

  masks.forEach((mask) => {
    if (!assets.has(mask.assetId)) {
      throw new Error(`Canvas mask "${mask.id}" has unresolved asset ID "${mask.assetId}".`)
    }
  })
  const isRasterOnly = (candidate: LayerDefinition): boolean => {
    const candidateRenderer = findRenderer(renderers, rendererKey(candidate))
    if (!candidateRenderer) return false
    if (candidate.kind === "group") {
      const children = childLayers(candidate)
      if (!children || children.length === 0) return false
      return children.every(isRasterOnly)
    }
    return candidateRenderer.output === "raster"
  }
  Object.entries(layerMasks).forEach(([layerId, mask]) => {
    const layer = layersById.get(layerId)
    if (!layer) {
      throw new Error(`Canvas mask "${mask.id}" references unknown layer "${layerId}".`)
    }
    const renderer = findRenderer(renderers, rendererKey(layer))
    const validTarget =
      renderer?.output === "raster" || (layer.kind === "group" && isRasterOnly(layer))
    if (!validTarget && layer.kind === "group") {
      throw new Error(`Canvas mask "${mask.id}" can only target a raster-only group "${layerId}".`)
    }
    if (!validTarget) {
      throw new Error(`Canvas mask "${mask.id}" can only target raster-output layer "${layerId}".`)
    }
    if (!mask.coverageLayerId) return
    const coverageLayer = layersById.get(mask.coverageLayerId)
    if (!coverageLayer) {
      throw new Error(
        `Canvas mask "${mask.id}" references unknown coverage layer "${mask.coverageLayerId}".`,
      )
    }
    const coverageRenderer = findRenderer(renderers, rendererKey(coverageLayer))
    if (coverageRenderer?.output !== "raster") {
      throw new Error(
        `Canvas mask "${mask.id}" coverage layer "${mask.coverageLayerId}" must use raster output.`,
      )
    }
    if ((layerOrder.get(mask.coverageLayerId) ?? Infinity) >= (layerOrder.get(layerId) ?? -1)) {
      throw new Error(
        `Canvas mask "${mask.id}" coverage layer "${mask.coverageLayerId}" must render before target layer "${layerId}".`,
      )
    }
  })
}
