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

import { selectedArtworkMask as selectArtworkMask } from "./artwork-mask-state"

import type { ArtworkMaskEditingState, ArtworkMaskEffects, EditorMode } from "./editor-document"
import type {
  ArtworkLayer,
  ArtworkTransform,
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

export interface ArtworkEditorConfig {
  /** The image field the template's primary artwork layer consumes. */
  field: string
  /** The image field used by the template's artwork overlay mask. */
  maskField?: string
  /** The source channel the template uses for mask coverage. */
  maskChannel: "alpha" | "luminance"
  /** Shared transform used by the primary artwork layer and any overlay layers. */
  transformId: string
  /** Whether the template explicitly permits a full-card artwork overlay. */
  supportsFullArt: boolean
}

/** Derives artwork authoring capabilities from the active template instead of hard-coding layer IDs. */
export function artworkEditorConfig(template = editorTemplate): ArtworkEditorConfig {
  // The primary artwork layer is the unconditional one: overlay variants are gated behind an
  // opaque transform mode. Its card field is the artwork source every editor control authors, so
  // the app derives that name from the template rather than assuming one.
  const artworkLayers: ArtworkLayer[] = []
  walkLayers(template.layers, ({ layer }) => {
    if (layer.kind === "artwork") artworkLayers.push(layer as ArtworkLayer)
  })
  const field =
    (artworkLayers.find((layer) => layer.transformMode === undefined) ?? artworkLayers[0])?.field ??
    "artwork"

  let primaryTransformId: string | undefined
  let maskField: string | undefined
  let maskChannel: "alpha" | "luminance" = "luminance"
  let supportsFullArt = false
  walkLayers(template.layers, ({ layer }) => {
    if (layer.kind !== "artwork" || layer.field !== field) return
    const artworkLayer = layer as ArtworkLayer
    primaryTransformId ??= artworkLayer.transformId ?? artworkLayer.id
    maskField ??= artworkLayer.maskField
    if (
      artworkLayer.maskField &&
      maskField === artworkLayer.maskField &&
      artworkLayer.maskChannel
    ) {
      maskChannel = artworkLayer.maskChannel
    }
    supportsFullArt ||= artworkLayer.transformMode === "full-art"
  })
  return {
    ...(maskField ? { maskField } : {}),
    field,
    maskChannel,
    supportsFullArt,
    transformId: primaryTransformId ?? field,
  }
}

/** The default template's artwork field, for modules that are not given an active template. */
export const editorArtworkField = artworkEditorConfig().field

export function isDefaultArtworkMaskEffects(effects: ArtworkMaskEffects | undefined) {
  return effects?.antiAlias !== true && (effects?.glow ?? 0) === 0
}

/** Presentation overrides are sparse; an identity transform is the template default. */
export function isDefaultArtworkTransform(transform: ArtworkTransform) {
  return (
    transform.scale === 1 && transform.x === 0 && transform.y === 0 && transform.mode === undefined
  )
}

/** The zoom full art opens at: the framed placement leaves too much card showing through. */
const FULL_ART_START_SCALE = 1.5

export function hasArtworkCrop(transform: ArtworkTransform) {
  const { scale, x, y } = resetArtworkCrop(transform)
  return transform.scale !== scale || transform.x !== x || transform.y !== y
}

/**
 * Returns the artwork to where the layout starts it, keeping the layout mode.
 *
 * Zoom and pan are a crop; full art is a layout the card is built in. Clearing the crop must not
 * decide the layout question on the author's behalf — dropping the mode here would switch the card
 * back to a framed artwork and tear down the workspace the button lives beside. Full art has its
 * own starting zoom, so resetting inside it lands there rather than on the framed placement.
 */
export function resetArtworkCrop(transform: ArtworkTransform): ArtworkTransform {
  return {
    mode: transform.mode,
    scale: transform.mode === "full-art" ? FULL_ART_START_SCALE : 1,
    x: 0,
    y: 0,
  }
}

/**
 * Enables the overlay clipping mode with the useful 150% starting zoom once. Disabling full art
 * returns the artwork to the template identity so the temporary full-art crop does not linger.
 */
export function toggleArtworkFullArt(transform: ArtworkTransform): ArtworkTransform {
  if (transform.mode === "full-art") return { scale: 1, x: 0, y: 0 }
  return {
    ...transform,
    mode: "full-art",
    scale: transform.scale === 1 ? FULL_ART_START_SCALE : transform.scale,
  }
}

/** The expensive side-by-side mask workspace exists only while full-art editing is active. */
export function shouldRenderArtworkWorkspace(
  artwork: unknown,
  transform: ArtworkTransform | undefined,
): artwork is Blob {
  return artwork instanceof Blob && transform?.mode === "full-art"
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
  mode: EditorMode,
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

/**
 * Projects the complete editor document into the card sources consumed by preview and export.
 * Artwork masks are editor-owned state, so they must be applied here instead of relying on the
 * hidden legacy `card.artworkOverlay` field being synchronized by every save path.
 */
export function projectCardForRender(
  card: CardData,
  mode: EditorMode,
  artworkMask: ArtworkMaskEditingState,
  template = editorTemplate,
  processedArtworkMask?: Blob,
): CardData {
  const projected = projectCardForEditorMode(card, mode, template)
  const selectedMask = selectArtworkMask(artworkMask)
  return {
    ...projected,
    artworkOverlay: processedArtworkMask ?? selectedMask ?? "",
  }
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
      kind: "artwork-transform"
      label: string
      transformId: string
      value: string
    }
  | {
      id: string
      kind: "artwork-mask-effects"
      label: string
      maskField: string
      value: string
    }
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

/**
 * Text styles that may expose generated color/outline controls: currently rendered layers whose
 * `editorVisible` flag is not `false`. This is the same declared policy the generated layer-
 * visibility controls already use, so a renderer-only implementation layer never grows a paint
 * control and no Series-specific list is needed here.
 */
export function paintableTextStyles(
  layers: Readonly<Record<string, boolean | undefined>>,
  presentation: ResolvedCardPresentation,
  template: CardTemplate = editorTemplate,
) {
  const { activeLayerIds } = activePresentationSubjects(layers, presentation, template)
  const editorVisible = new Set<string>()
  walkLayers(template.layers, ({ layer }) => {
    if (layer.kind === "text" && layer.editorVisible !== false) editorVisible.add(layer.id)
  })
  return Object.values(presentation.text).filter(
    ({ layerId }) => editorVisible.has(layerId) && activeLayerIds.has(layerId),
  )
}

function describeStroke(value: unknown) {
  if (value === null) return "outline: none"
  if (typeof value !== "object" || value === null) return undefined
  const stroke = value as { color?: unknown; width?: unknown }
  if (typeof stroke.color !== "string" || typeof stroke.width !== "number") return undefined
  return `outline: ${stroke.width}px ${stroke.color}`
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
      if (key === "fill" && typeof value === "string") return `color: ${value}`
      if (key === "stroke") {
        const described = describeStroke(value)
        if (described) return described
      }
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
  appArtworkMaskEffects: Readonly<Record<string, ArtworkMaskEffects | undefined>> = {},
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

  Object.entries(presentationOverrides.artworkTransforms ?? {}).forEach(([transformId, value]) => {
    if (!value || isDefaultArtworkTransform(value)) return
    active.push({
      id: `artwork-transform:${transformId}`,
      kind: "artwork-transform",
      label: "Artwork crop and placement",
      transformId,
      value: `${Math.round(value.scale * 100)}% zoom, ${Math.round(value.x * 100)}% x, ${Math.round(value.y * 100)}% y${value.mode ? `, ${value.mode.replaceAll("-", " ")}` : ""}`,
    })
  })

  Object.entries(appArtworkMaskEffects).forEach(([maskField, value]) => {
    if (isDefaultArtworkMaskEffects(value)) return
    const choices = [
      value?.antiAlias === true ? "anti-aliasing" : undefined,
      value?.glow && value.glow > 0 ? `${value.glow}px glow` : undefined,
    ].filter((choice): choice is string => choice !== undefined)
    active.push({
      id: `artwork-mask-effects:${maskField}`,
      kind: "artwork-mask-effects",
      label: "Artwork mask edges",
      maskField,
      value: choices.join(", "),
    })
  })

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
  appArtworkMaskEffects: Readonly<Record<string, ArtworkMaskEffects | undefined>> = {},
) {
  return getActivePresentationOverrides(
    layers,
    presetOverrides,
    presentationOverrides,
    presentation,
    template,
    colorPresets,
    appArtworkMaskEffects,
  ).length
}
