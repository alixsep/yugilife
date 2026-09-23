import { editorColorPresets, editorTemplate } from "../../build/editor/model/editor-config"
import { validateEditorDocumentState } from "../../build/editor/model/editor-document-validation"
import { createInitialEditorDocument } from "../../build/editor/model/editor-store"
import {
  moveLegacyArtworkMaskEffects,
  moveLegacyArtworkTransformMode,
} from "../../build/migrations/document"
import { migrateEditorTemplateVersion } from "../../build/migrations/template"
import { readStoredTemplate } from "../../build/templates/template-storage"

import type { EditorDocumentState } from "../../build/editor/model/editor-document"
import type { InventoryCard } from "./inventory-card"

/**
 * Migrates a saved card to the currently supported template before it enters the editor. Template
 * migrations are deliberately separate from inventory-record migrations and ordinary transitions.
 */
export function migrateInventoryCardDocument(
  document: EditorDocumentState,
  current: EditorDocumentState,
  template?: Parameters<typeof validateEditorDocumentState>[1],
  colorPresets?: Parameters<typeof validateEditorDocumentState>[2],
) {
  const migrated = migrateEditorTemplateVersion(document, current)
  if (!migrated) {
    throw new Error(
      `No migration is available from template "${document.templateId}@${document.templateVersion}" to "${current.templateId}@${current.templateVersion}".`,
    )
  }
  const moved = moveLegacyArtworkTransformMode(moveLegacyArtworkMaskEffects(migrated))
  const candidate: EditorDocumentState = {
    ...current,
    ...moved,
    card: { ...current.card, ...moved.card },
    layers: moved.layers ?? {},
    presetOverrides: moved.presetOverrides ?? {},
    presentationOverrides: moved.presentationOverrides ?? {},
    artworkMaskEffects: moved.artworkMaskEffects ?? {},
    templateId: current.templateId,
    templateVersion: current.templateVersion,
  }
  return validateEditorDocumentState(candidate, template, colorPresets)
}

export async function migrateInventoryCardToCurrentTemplate(saved: InventoryCard) {
  let current = createInitialEditorDocument()
  let template = editorTemplate
  let colorPresets = editorColorPresets
  if (saved.document.templateId.startsWith("user/")) {
    const stored = await readStoredTemplate(saved.document.templateId)
    if (!stored || stored.source !== "user") {
      throw new Error(
        `The card requires user template "${saved.document.templateId}", which is not installed.`,
      )
    }
    current = { ...current, templateId: stored.id, templateVersion: stored.version }
    template = stored.bundle.template
    colorPresets = stored.bundle.colorPresets
  }
  const document = migrateInventoryCardDocument(saved.document, current, template, colorPresets)
  if (
    document.templateId === saved.document.templateId &&
    document.templateVersion === saved.document.templateVersion
  ) {
    return saved
  }
  return {
    ...saved,
    document,
    revision: saved.revision + 1,
    updatedAt: Date.now(),
  }
}
