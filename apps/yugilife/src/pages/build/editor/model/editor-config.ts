import {
  collectLayerGroups,
  collectPresetTargets,
  createCardFromTemplate,
  defaultLayerVisibility,
  defaultPresetForTarget,
  deriveCardSemantics,
  matchesSemanticCondition,
  resolveCardPresentation,
  walkLayers,
} from "yugilife-core"
import { DEFAULT_TEMPLATE } from "yugilife-templates"

import type {
  CardData,
  CardTemplate,
  ColorPresetCollection,
  PresentationOverrides,
  ResolvedCardPresentation,
  SemanticCondition,
} from "yugilife-core"

export const editorTemplateId = DEFAULT_TEMPLATE.id
export const editorTemplateVersion = DEFAULT_TEMPLATE.version
export const editorTemplate = DEFAULT_TEMPLATE.template
export const editorTemplateName = DEFAULT_TEMPLATE.name
export const editorCardFields = editorTemplate.cardFields
export const editorLayerGroups = collectLayerGroups(editorTemplate)
export const editorLayerIds = new Set(
  editorLayerGroups.flatMap((group) => group.layers.map(({ id }) => id)),
)
export const editorDefaultLayerVisibility = defaultLayerVisibility(editorTemplate)
export const editorColorPresets = DEFAULT_TEMPLATE.colorPresets

/** Text-fit controls explicitly exposed beside template fields in Automatic mode. */
export const automaticTextFitLayerIds = new Set(
  editorCardFields.flatMap((field) => (field.automaticFitLayer ? [field.automaticFitLayer] : [])),
)

export function isAutomaticTextFitLayer(layerId: string, template = editorTemplate) {
  return template.cardFields.some((field) => field.automaticFitLayer === layerId)
}

export function createInitialCard() {
  return createCardFromTemplate(editorTemplate)
}

/**
 * Projects the persisted card into the values used by the automatic preview/export. Advanced-only
 * fields remain persisted, but they cannot override semantic auto-derivation while automatic mode
 * is selected. Presentation overrides are separate from this card projection and remain effective
 * in both editor modes. Semantic bindings and semantic text paths derive displayed values from the
 * projected card without requiring app-level knowledge of a particular card family.
 */
export function projectCardForEditorMode(
  card: CardData,
  mode: "automatic" | "advanced",
  template = editorTemplate,
): CardData {
  if (mode === "advanced") return card
  const advancedFieldNames = new Set(
    template.cardFields.filter((field) => field.advancedOnly).map((field) => field.name),
  )
  return Object.fromEntries(
    Object.entries(card).filter(([fieldName]) => !advancedFieldNames.has(fieldName)),
  ) as CardData
}

/** Returns the template-declared card inputs that Automatic mode should expose. */
export function editorCardFieldsForMode(
  card: CardData,
  mode: "automatic" | "advanced",
  template = editorTemplate,
) {
  if (mode === "advanced") return template.cardFields
  const semantics = deriveCardSemantics(projectCardForEditorMode(card, mode, template), template)
  return template.cardFields.filter((field) => {
    if (field.advancedOnly) return false
    if (field.automaticWhen === undefined) return true
    const conditions: readonly SemanticCondition[] = Array.isArray(field.automaticWhen)
      ? (field.automaticWhen as readonly SemanticCondition[])
      : [field.automaticWhen as SemanticCondition]
    return conditions.some((condition) => matchesSemanticCondition(semantics, condition))
  })
}

export function createInitialLayerVisibility() {
  return {}
}

export interface PresetTarget {
  defaultPreset: string
  label: string
  presets: readonly string[]
  target: string
}

function labelForTarget(target: string) {
  const label = target.replaceAll("-", " ")
  return `${label.charAt(0).toLocaleUpperCase()}${label.slice(1)}`
}

export function presetTargetsForTemplate(
  template: CardTemplate,
  colorPresets: ColorPresetCollection,
): readonly PresetTarget[] {
  return collectPresetTargets(template).map((target) => ({
    defaultPreset: defaultPresetForTarget(template, target) ?? "",
    label: labelForTarget(target),
    presets: Object.keys(colorPresets)
      .filter((name) => colorPresets[name]?.metadata?.target === target)
      .sort(),
    target,
  }))
}

export const editorPresetTargets = presetTargetsForTemplate(editorTemplate, editorColorPresets)

export function createInitialPresetOverrides() {
  return {}
}

export type ActivePresentationOverride =
  | {
      id: string
      kind: "layer"
      label: string
      layerId: string
      value: string
    }
  | {
      id: string
      kind: "preset"
      label: string
      target: string
      value: string
    }
  | {
      id: string
      kind: "text-fit"
      label: string
      layerId: string
      styleId: string
      value: string
    }
  | {
      id: string
      kind: "text-typography"
      label: string
      layerId: string
      styleId: string
      value: string
    }
  | {
      id: string
      kind: "layer-mask"
      label: string
      layerId: string
      value: string
    }

function labelForLayer(layerId: string, labels: ReadonlyMap<string, string>) {
  return labels.get(layerId) ?? layerId
}

function labelsForTemplate(template: CardTemplate) {
  const labels = new Map<string, string>()
  walkLayers(template.layers, ({ layer }) => {
    labels.set(layer.id, layer.label ?? layer.id)
  })
  return labels
}

function activePresentationSubjects(
  layers: Readonly<Record<string, boolean | undefined>>,
  presentation: ResolvedCardPresentation,
  template: CardTemplate,
) {
  const activeLayerIds = new Set<string>()
  const activePresetTargets = new Set<string>()
  walkLayers(template.layers, ({ ancestors, layer }) => {
    const visible = (candidate: typeof layer) =>
      layers[candidate.id] ??
      presentation.layerVisibility[candidate.id] ??
      candidate.defaultVisible ??
      true
    if (!visible(layer) || ancestors.some((ancestor) => !visible(ancestor))) return
    activeLayerIds.add(layer.id)
    if (layer.kind === "raster" && typeof layer.presetTarget === "string") {
      activePresetTargets.add(layer.presetTarget)
    }
  })
  return { activeLayerIds, activePresetTargets }
}

function formatTypographyPatch(patch: Readonly<Record<string, unknown>>) {
  return Object.entries(patch)
    .map(([key, value]) => {
      if (key === "maxAutoCompressionX" && typeof value === "number") {
        return `maximum automatic horizontal compression: ${Math.round(value * 100)}%`
      }
      if (key === "fitProfiles" && Array.isArray(value)) {
        const compressions = value.flatMap((profile) =>
          typeof profile === "object" &&
          profile !== null &&
          typeof (profile as { maxAutoCompressionX?: unknown }).maxAutoCompressionX === "number"
            ? [(profile as { maxAutoCompressionX: number }).maxAutoCompressionX]
            : [],
        )
        if (
          compressions.length === value.length &&
          compressions.every((compression) => compression === compressions[0])
        ) {
          return `maximum automatic horizontal compression: ${Math.round((compressions[0] ?? 0) * 100)}%`
        }
      }
      if (key === "fitBlocks" && value === null) return "leading authored-line fitting: off"
      if (value === null) return `${key}: clear`
      if (typeof value === "string") return `${key}: ${value}`
      return `${key}: ${JSON.stringify(value) ?? "undefined"}`
    })
    .join(", ")
}

/** Returns explicit presentation choices that currently affect the resolved template presentation. */
export function getActivePresentationOverrides(
  layers: Readonly<Record<string, boolean | undefined>>,
  presetOverrides: Readonly<Record<string, string>>,
  presentationOverrides: PresentationOverrides,
  presentation: ResolvedCardPresentation,
  template = editorTemplate,
  colorPresets = editorColorPresets,
) {
  const active: ActivePresentationOverride[] = []
  const labels = labelsForTemplate(template)
  const layerIds = new Set<string>()
  walkLayers(template.layers, ({ layer }) => layerIds.add(layer.id))
  const defaultVisibility = defaultLayerVisibility(template)
  const presetTargets = presetTargetsForTemplate(template, colorPresets)
  const { activeLayerIds, activePresetTargets } = activePresentationSubjects(
    layers,
    presentation,
    template,
  )

  Object.entries(layers).forEach(([layerId, visible]) => {
    if (visible === undefined || !layerIds.has(layerId)) return
    const resolvedVisibility =
      presentation.layerVisibility[layerId] ?? defaultVisibility[layerId] ?? true
    if (visible !== resolvedVisibility) {
      active.push({
        id: `layer:${layerId}`,
        kind: "layer",
        label: `${labelForLayer(layerId, labels)} visibility`,
        layerId,
        value: visible ? "Visible" : "Hidden",
      })
    }
  })

  Object.entries(presetOverrides).forEach(([target, preset]) => {
    if (!activePresetTargets.has(target)) return
    const targetDefinition = presetTargets.find((entry) => entry.target === target)
    if (!targetDefinition) return
    const resolvedPreset = presentation.presets[target] ?? targetDefinition.defaultPreset
    if (preset !== resolvedPreset) {
      active.push({
        id: `preset:${target}`,
        kind: "preset",
        label: `${targetDefinition.label} preset`,
        target,
        value: preset || "Original texture",
      })
    }
  })

  Object.entries(presentationOverrides.textFitProfiles ?? {}).forEach(([layerId, styles]) => {
    if (isAutomaticTextFitLayer(layerId, template) || !activeLayerIds.has(layerId)) return
    const resolvedText = presentation.text[layerId]
    const profileId = resolvedText ? styles?.[resolvedText.styleId] : undefined
    if (resolvedText && profileId) {
      const profile = resolvedText.typography.fitProfiles?.find(({ id }) => id === profileId)
      active.push({
        id: `text-fit:${layerId}:${resolvedText.styleId}`,
        kind: "text-fit",
        label: `${resolvedText.styleLabel} text fitting`,
        layerId,
        styleId: resolvedText.styleId,
        value: profile?.label ?? profileId,
      })
    }
  })

  Object.entries(presentationOverrides.textTypography ?? {}).forEach(([layerId, styles]) => {
    if (!activeLayerIds.has(layerId)) return
    const resolvedText = presentation.text[layerId]
    const patch = resolvedText ? styles?.[resolvedText.styleId] : undefined
    if (resolvedText && patch && Object.keys(patch).length > 0) {
      active.push({
        id: `text-typography:${layerId}:${resolvedText.styleId}`,
        kind: "text-typography",
        label: `${resolvedText.styleLabel} typography`,
        layerId,
        styleId: resolvedText.styleId,
        value: formatTypographyPatch(patch),
      })
    }
  })

  const basePresentation = resolveCardPresentation(template, presentation.semantics)
  Object.entries(presentationOverrides.layerMasks ?? {}).forEach(([layerId, maskId]) => {
    if (maskId === undefined) return
    const baseMaskId = basePresentation.layerMasks[layerId]?.id ?? null
    if (maskId === baseMaskId) return
    active.push({
      id: `layer-mask:${layerId}`,
      kind: "layer-mask",
      label: `${labelForLayer(layerId, labels)} mask`,
      layerId,
      value: maskId ?? "No mask",
    })
  })

  return active
}

/** Counts explicit presentation choices that change the current resolved template presentation. */
export function countActivePresentationOverrides(
  layers: Readonly<Record<string, boolean | undefined>>,
  presetOverrides: Readonly<Record<string, string>>,
  presentationOverrides: PresentationOverrides,
  presentation: ResolvedCardPresentation,
  template = editorTemplate,
  colorPresets = editorColorPresets,
) {
  return getActivePresentationOverrides(
    layers,
    presetOverrides,
    presentationOverrides,
    presentation,
    template,
    colorPresets,
  ).length
}
