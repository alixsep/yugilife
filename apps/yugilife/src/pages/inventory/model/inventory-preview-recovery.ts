import { exportCardToImage } from "yugilife-core"
import { getOfficialTemplate } from "yugilife-templates"

import { projectCardForEditorMode } from "../../build/editor/model/editor-config"
import { storeInventoryPreview } from "../persistence/inventory-storage"

import {
  inventoryPreviewExportOptions,
  inventoryPreviewFingerprint,
  inventoryPreviewMatchesCard,
} from "./inventory-preview"

import type { InventoryCard, InventoryCardPreview } from "./inventory-card"

export function inventoryPreviewNeedsRecovery(
  preview: InventoryCardPreview | undefined,
  card: InventoryCard,
) {
  if (
    preview &&
    inventoryPreviewMatchesCard(preview, {
      id: card.id,
      revision: card.revision,
      templateId: card.document.templateId,
      templateVersion: card.document.templateVersion,
    })
  ) {
    return false
  }
  return true
}

/** Renders and persists a current official-template preview when stored metadata cannot be reused. */
export async function recoverInventoryPreview(
  preview: InventoryCardPreview | undefined,
  card: InventoryCard,
) {
  if (
    !inventoryPreviewNeedsRecovery(preview, card) ||
    card.document.templateId.startsWith("user/")
  ) {
    return preview
  }
  const official = getOfficialTemplate(card.document.templateId)
  if (official.version !== card.document.templateVersion) return preview
  const templateBundle = await official.load()
  const image = await exportCardToImage(
    projectCardForEditorMode(card.document.card, card.document.mode, templateBundle.template),
    {
      ...inventoryPreviewExportOptions,
      layers: card.document.layers,
      presentationOverrides: card.document.presentationOverrides,
      presetOverrides: card.document.presetOverrides,
      templateBundle,
    },
  )
  const recovered: InventoryCardPreview = {
    cardId: card.id,
    cardRevision: card.revision,
    image,
    renderFingerprint: inventoryPreviewFingerprint(
      card.document.templateId,
      card.document.templateVersion,
    ),
  }
  await storeInventoryPreview(recovered)
  return recovered
}
