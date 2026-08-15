import { collectLayerGroups, validateCardData, validatePresentationOverrides } from "yugilife-core"

import { isTemplateVersion } from "../../migrations/template"

import { editorColorPresets, editorTemplate, presetTargetsForTemplate } from "./editor-config"

import type { EditorDocumentState } from "./editor-document"
import type { CardTemplate, ColorPresetCollection } from "yugilife-core"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const editorDocumentStateKeys = new Set([
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

  validateCardData(document.card, template)
  validateLayerVisibility(document, template)
  validatePresetOverrides(document, template, colorPresets)
  validatePresentationOverrides(document.presentationOverrides, template)
  return document
}
