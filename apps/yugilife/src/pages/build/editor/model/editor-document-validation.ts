import {
  collectLayerGroups,
  validateCardData,
  validatePresentationOverrides,
  walkLayers,
} from "yugilife-core"

import { isTemplateVersion } from "../../migrations/template"

import { editorColorPresets, editorTemplate, presetTargetsForTemplate } from "./editor-config"

import type { EditorDocumentState } from "./editor-document"
import type { CardTemplate, ColorPresetCollection } from "yugilife-core"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const editorDocumentStateKeys = new Set([
  "artworkMask",
  "artworkMaskEffects",
  "card",
  "layers",
  "mode",
  "presetOverrides",
  "presentationOverrides",
  "templateId",
  "templateVersion",
])

function validateLayerVisibility(document: EditorDocumentState, template: CardTemplate) {
  if (!isRecord(document.layers)) {
    throw new Error("Editor document layers must be an object.")
  }
  const layerIds = new Set(
    collectLayerGroups(template).flatMap((group) => group.layers.map(({ id }) => id)),
  )
  for (const [layerId, visible] of Object.entries(document.layers)) {
    if (!layerIds.has(layerId)) {
      throw new Error(`Editor document contains unknown layer "${layerId}".`)
    }
    if (typeof visible !== "boolean") {
      throw new Error(`Editor document layer "${layerId}" visibility must be boolean.`)
    }
  }
}

function validatePresetOverrides(
  document: EditorDocumentState,
  template: CardTemplate,
  colorPresets: ColorPresetCollection,
) {
  if (!isRecord(document.presetOverrides)) {
    throw new Error("Editor document presetOverrides must be an object.")
  }
  const targets = new Map(
    presetTargetsForTemplate(template, colorPresets).map((entry) => [entry.target, entry.presets]),
  )
  for (const [target, preset] of Object.entries(document.presetOverrides)) {
    const presets = targets.get(target)
    if (!presets) throw new Error(`Editor document contains unknown preset target "${target}".`)
    if (typeof preset !== "string" || (preset !== "" && !presets.includes(preset))) {
      throw new Error(
        `Editor document contains unknown preset "${String(preset)}" for "${target}".`,
      )
    }
  }
}

/** Validates complete editor state at both import and IndexedDB hydration boundaries. */
export function validateEditorDocumentState(
  document: EditorDocumentState,
  template: CardTemplate = editorTemplate,
  colorPresets: ColorPresetCollection = editorColorPresets,
) {
  const value: unknown = document
  if (!isRecord(value)) throw new Error("Editor document must be an object.")
  const unknown = Object.keys(value).find((key) => !editorDocumentStateKeys.has(key))
  if (unknown) throw new Error(`Editor document contains unknown property "${unknown}".`)
  if (!isRecord(document.card)) throw new Error("Editor document card must be an object.")
  if (typeof document.templateId !== "string" || document.templateId.length === 0) {
    throw new Error("Editor document templateId must be a non-empty string.")
  }
  if (!isTemplateVersion(document.templateVersion)) {
    throw new Error("Editor document templateVersion must use YYYY.MM.DD or YYYY.MM.DD.N.")
  }
  if (document.mode !== "automatic" && document.mode !== "advanced") {
    throw new Error('Editor document mode must be "automatic" or "advanced".')
  }
  if (!isRecord(document.artworkMask)) throw new Error("Editor artworkMask must be an object.")
  const maskKeys = new Set(["automaticMask", "manualMask", "mode", "points", "catalogSource"])
  const unknownMaskKey = Object.keys(document.artworkMask).find((key) => !maskKeys.has(key))
  if (unknownMaskKey)
    throw new Error(`Editor artworkMask contains unknown property "${unknownMaskKey}".`)
  if (document.artworkMask.mode !== "automatic" && document.artworkMask.mode !== "manual") {
    throw new Error('Editor artworkMask mode must be "automatic" or "manual".')
  }
  for (const source of [document.artworkMask.automaticMask, document.artworkMask.manualMask]) {
    if (source !== undefined && !(source instanceof Blob)) {
      throw new Error("Editor artwork masks must be Blob image sources.")
    }
  }
  if (!Array.isArray(document.artworkMask.points))
    throw new Error("Editor mask points must be an array.")
  const catalog = document.artworkMask.catalogSource
  if (
    catalog !== undefined &&
    (!isRecord(catalog) ||
      Object.keys(catalog).some(
        (key) => !["artworkId", "cardCid", "name", "passcode"].includes(key),
      ) ||
      !Number.isSafeInteger(catalog.artworkId) ||
      catalog.artworkId < 1 ||
      !Number.isSafeInteger(catalog.cardCid) ||
      catalog.cardCid < 1 ||
      typeof catalog.name !== "string" ||
      !catalog.name.trim() ||
      (catalog.passcode !== undefined && !/^\d{8}$/.test(catalog.passcode)))
  ) {
    throw new Error("Editor catalog artwork identity is invalid.")
  }
  if (document.artworkMask.points.length > 100_000)
    throw new Error("Editor mask has too many points.")
  const pointIds = new Set<number>()
  document.artworkMask.points.forEach((point, index) => {
    if (!isRecord(point)) throw new Error(`Editor mask point ${index} must be an object.`)
    if (
      Object.keys(point).some((key) => !["id", "x", "y", "size", "polarity"].includes(key)) ||
      typeof point.id !== "number" ||
      typeof point.x !== "number" ||
      typeof point.y !== "number" ||
      typeof point.size !== "number" ||
      pointIds.has(point.id) ||
      point.id < 1 ||
      point.x < 0 ||
      point.y < 0 ||
      point.size < 4 ||
      point.size > 128 ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isFinite(point.size) ||
      !Number.isSafeInteger(point.id) ||
      (point.polarity !== "keep" && point.polarity !== "remove")
    ) {
      throw new Error(`Editor mask point ${index} is invalid.`)
    }
    pointIds.add(point.id)
  })

  if (!isRecord(document.artworkMaskEffects)) {
    throw new Error("Editor artworkMaskEffects must be an object.")
  }
  const artworkMaskFields = new Set<string>()
  walkLayers(template.layers, ({ layer }) => {
    if (layer.kind === "artwork" && typeof layer.maskField === "string") {
      artworkMaskFields.add(layer.maskField)
    }
  })
  for (const [maskField, effects] of Object.entries(document.artworkMaskEffects)) {
    if (effects === undefined) continue
    if (!artworkMaskFields.has(maskField)) {
      throw new Error(`Editor artwork mask effects reference unknown mask field "${maskField}".`)
    }
    if (!isRecord(effects)) {
      throw new Error(`Editor artwork mask effects for "${maskField}" must be an object.`)
    }
    const unknownEffectKey = Object.keys(effects).find(
      (key) => key !== "antiAlias" && key !== "glow",
    )
    if (unknownEffectKey) {
      throw new Error(`Editor artwork mask effects contain unknown property "${unknownEffectKey}".`)
    }
    if (effects.antiAlias !== undefined && typeof effects.antiAlias !== "boolean") {
      throw new Error(`Editor artwork mask antiAlias for "${maskField}" must be boolean.`)
    }
    if (
      effects.glow !== undefined &&
      (typeof effects.glow !== "number" ||
        !Number.isFinite(effects.glow) ||
        effects.glow < 0 ||
        effects.glow > 128)
    ) {
      throw new Error(`Editor artwork mask glow for "${maskField}" must be between 0 and 128.`)
    }
  }

  validateCardData(document.card, template)
  validateLayerVisibility(document, template)
  validatePresetOverrides(document, template, colorPresets)
  validatePresentationOverrides(document.presentationOverrides, template)
  return document
}
