import type {
  CardTemplate,
  GroupLayer,
  LayerDefinition,
  LayerGroup,
  LayerVisibility,
  RasterLayer,
  TextLayer,
  TextTypography,
  TextTypographyPatch,
} from "../contracts/index.js"

/** The single place that knows a layer can contain other layers. */
export function childLayers(layer: LayerDefinition): readonly LayerDefinition[] | undefined {
  if (layer.kind !== "group") return undefined
  const layers: unknown = (layer as GroupLayer).layers
  return Array.isArray(layers) ? (layers as readonly LayerDefinition[]) : []
}

export function isGroupLayer(layer: LayerDefinition): layer is GroupLayer {
  return childLayers(layer) !== undefined
}

export function isTextLayer(layer: LayerDefinition): layer is TextLayer {
  return layer.kind === "text"
}

/** Applies sparse typography patches from lowest to highest precedence. */
export function mergeTextTypography(
  base: TextTypography,
  ...patches: readonly (TextTypographyPatch | undefined)[]
): TextTypography {
  const merged: Record<string, unknown> = { ...base }
  for (const patch of patches) {
    if (!patch) continue
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue
      if (key === "fitProfileOverrides" && value && typeof value === "object") {
        const overrides = value as Readonly<Record<string, Record<string, unknown> | undefined>>
        const profiles = merged["fitProfiles"]
        if (!Array.isArray(profiles)) {
          throw new Error("fitProfileOverrides requires resolved fitProfiles.")
        }
        const seen = new Set<string>()
        merged["fitProfiles"] = profiles.map((profile) => {
          const current = profile as Record<string, unknown>
          const id = String(current["id"])
          const profilePatch = overrides[id]
          if (!profilePatch) return current
          seen.add(id)
          const resolved = { ...current }
          Object.entries(profilePatch).forEach(([profileKey, profileValue]) => {
            if (profileValue === null) delete resolved[profileKey]
            else if (profileValue !== undefined) resolved[profileKey] = profileValue
          })
          return resolved
        })
        Object.keys(overrides).forEach((id) => {
          if (!seen.has(id))
            throw new Error(`fitProfileOverrides references unknown profile "${id}".`)
        })
      } else if (key === "fitProfileSet") {
        throw new Error("fitProfileSet is only available while authoring a template.")
      } else if (value === null) delete merged[key]
      else merged[key] = value
    }
  }
  delete merged["fitProfileOverrides"]
  delete merged["fitProfileSet"]
  return Object.freeze(merged as unknown as TextTypography)
}

/** Every typography a semantic text layer may resolve to, including its fallback. */
export function textTypographies(layer: TextLayer) {
  return [
    layer.typography,
    ...(layer.semanticStyles?.map((style) =>
      mergeTextTypography(layer.typography, style.typography),
    ) ?? []),
  ]
}

export function isRasterLayer(layer: LayerDefinition): layer is RasterLayer {
  return layer.kind === "raster"
}

export interface LayerVisit {
  /** Ancestor group layers, outermost first. */
  ancestors: readonly LayerDefinition[]
  layer: LayerDefinition
}

/**
 * Depth-first pre-order walk over a layer tree, including group layers themselves. Every traversal
 * in the project routes through here so that adding a container kind only changes `childLayers`.
 */
export function walkLayers(
  layers: readonly LayerDefinition[],
  visitor: (visit: LayerVisit) => void,
) {
  const visit = (current: readonly LayerDefinition[], ancestors: readonly LayerDefinition[]) => {
    for (const layer of current) {
      visitor({ ancestors, layer })
      const children = childLayers(layer)
      if (children) visit(children, [...ancestors, layer])
    }
  }
  visit(layers, [])
}

/** Every layer in tree order, groups included. */
export function flattenLayers(layers: readonly LayerDefinition[]): LayerDefinition[] {
  const flattened: LayerDefinition[] = []
  walkLayers(layers, ({ layer }) => flattened.push(layer))
  return flattened
}

/** Only layers that draw something; group containers are omitted. */
export function flattenDrawableLayers(layers: readonly LayerDefinition[]): LayerDefinition[] {
  return flattenLayers(layers).filter((layer) => !isGroupLayer(layer))
}

export function isLayerVisible(layer: LayerDefinition, visibility: LayerVisibility) {
  return visibility[layer.id] ?? layer.defaultVisible ?? true
}

/** Default visibility for every toggleable layer in a template. */
export function defaultLayerVisibility(template: CardTemplate): LayerVisibility {
  return Object.fromEntries(
    flattenDrawableLayers(template.layers).map((layer) => [layer.id, layer.defaultVisible ?? true]),
  )
}

/**
 * Toggleable layers bucketed by their declared `group` label, in first-appearance order. Drives
 * layer-visibility UI without the consumer re-implementing traversal or narrowing.
 */
export function collectLayerGroups(template: CardTemplate, fallbackLabel = "Other"): LayerGroup[] {
  const groups = new Map<string, { id: string; label: string }[]>()
  flattenDrawableLayers(template.layers)
    .filter((layer) => layer.editorVisible ?? true)
    .forEach((layer) => {
      const label = layer.group ?? fallbackLabel
      const entries = groups.get(label) ?? []
      entries.push({ id: layer.id, label: layer.label ?? layer.id })
      groups.set(label, entries)
    })
  return [...groups].map(([label, layers]) => ({ label, layers }))
}

/** Color-preset names declared by raster layers for a given preset target. */
export function defaultPresetForTarget(template: CardTemplate, target: string): string | undefined {
  for (const layer of flattenDrawableLayers(template.layers)) {
    if (isRasterLayer(layer) && layer.presetTarget === target && layer.defaultPreset) {
      return layer.defaultPreset
    }
  }
  return undefined
}

/** Every distinct preset target declared by the template's raster layers, in tree order. */
export function collectPresetTargets(template: CardTemplate): string[] {
  const targets: string[] = []
  flattenDrawableLayers(template.layers).forEach((layer) => {
    if (isRasterLayer(layer) && layer.presetTarget && !targets.includes(layer.presetTarget)) {
      targets.push(layer.presetTarget)
    }
  })
  return targets
}
