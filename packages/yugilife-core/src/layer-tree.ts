// Layer-tree queries. The core decides the traversal and answers with each layer's position in
// the tree, so the results here are the caller's own layer objects, as before.

import { callSync, layersKey, templateKey } from "./core/sync"

import type {
  CardTemplate,
  GroupLayer,
  LayerDefinition,
  LayerGroup,
  LayerVisibility,
  TextLayer,
  TextTypography,
} from "./contracts/index.js"

export interface LayerVisit {
  /** Ancestor group layers, outermost first. */
  ancestors: readonly LayerDefinition[]
  layer: LayerDefinition
}

function layerPaths(layers: readonly LayerDefinition[], drawable: boolean) {
  return callSync<readonly (readonly number[])[]>("layerPaths", {
    drawable,
    layers: layersKey(layers),
  })
}

/** The layers along a path, outermost first. */
function layersAlong(layers: readonly LayerDefinition[], path: readonly number[]) {
  const along: LayerDefinition[] = []
  let current = layers
  for (const index of path) {
    const layer = current[index]
    if (!layer) throw new Error("A layer path does not match its layer tree.")
    along.push(layer)
    current = (layer as GroupLayer).layers ?? []
  }
  return along
}

/** Depth-first pre-order walk over a layer tree, including group layers themselves. */
export function walkLayers(
  layers: readonly LayerDefinition[],
  visitor: (visit: LayerVisit) => void,
) {
  for (const path of layerPaths(layers, false)) {
    const along = layersAlong(layers, path)
    const layer = along.pop()
    if (layer) visitor({ ancestors: along, layer })
  }
}

/** Every layer in tree order, groups included. */
export function flattenLayers(layers: readonly LayerDefinition[]): LayerDefinition[] {
  return layerPaths(layers, false).map(
    (path) => layersAlong(layers, path).at(-1) as LayerDefinition,
  )
}

/** Only layers that draw something; group containers are omitted. */
export function flattenDrawableLayers(layers: readonly LayerDefinition[]): LayerDefinition[] {
  return layerPaths(layers, true).map((path) => layersAlong(layers, path).at(-1) as LayerDefinition)
}

export function isLayerVisible(layer: LayerDefinition, visibility: LayerVisibility): boolean {
  return callSync("isLayerVisible", { layer, visibility })
}

export function defaultLayerVisibility(template: CardTemplate): LayerVisibility {
  return callSync("defaultLayerVisibility", { template: templateKey(template) })
}

/** Toggleable layers bucketed by their declared `group` label, in first-appearance order. */
export function collectLayerGroups(template: CardTemplate, fallbackLabel = "Other"): LayerGroup[] {
  return callSync("collectLayerGroups", { fallbackLabel, template: templateKey(template) })
}

/** The default color preset a raster layer declares for a preset target. */
export function defaultPresetForTarget(template: CardTemplate, target: string): string | undefined {
  return (
    callSync<string | null>("defaultPresetForTarget", {
      target,
      template: templateKey(template),
    }) ?? undefined
  )
}

/** Every distinct preset target declared by the template's raster layers, in tree order. */
export function collectPresetTargets(template: CardTemplate): string[] {
  return callSync("collectPresetTargets", { template: templateKey(template) })
}

/** Every typography a semantic text layer may resolve to: its own, then each style's. */
export function textTypographies(layer: TextLayer): TextTypography[] {
  return callSync("textTypographies", { layer })
}
