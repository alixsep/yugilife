import {
  readInventoryPreview,
  saveInventoryCard,
  saveInventoryCardSnapshot,
  storeInventoryPreview,
} from "../persistence/inventory-storage"

import { migrateInventoryCardToCurrentTemplate } from "./inventory-card-migration"
import { inventoryPreviewFingerprint } from "./inventory-preview"

import type { InventoryCard, InventoryCardPreview } from "./inventory-card"

const reusablePreviewUpgrade = {
  fromVersion: "2026.08.15",
  templateId: "card/series-10",
  toVersion: "2026.08.23",
} as const

function hasNoArtworkOverlay(card: InventoryCard) {
  const overlay = card.document.card.artworkOverlay
  return overlay === undefined || overlay === ""
}

function reusablePreview(
  preview: InventoryCardPreview | undefined,
  source: InventoryCard,
  target: InventoryCard,
): preview is InventoryCardPreview {
  return (
    preview !== undefined &&
    source.document.templateId === reusablePreviewUpgrade.templateId &&
    source.document.templateVersion === reusablePreviewUpgrade.fromVersion &&
    target.document.templateId === reusablePreviewUpgrade.templateId &&
    target.document.templateVersion === reusablePreviewUpgrade.toVersion &&
    preview.cardId === source.id &&
    preview.cardRevision === source.revision &&
    preview.renderFingerprint ===
      inventoryPreviewFingerprint(source.document.templateId, source.document.templateVersion, 1) &&
    hasNoArtworkOverlay(target)
  )
}

function repairablePreview(
  preview: InventoryCardPreview | undefined,
  card: InventoryCard,
): preview is InventoryCardPreview {
  return (
    preview !== undefined &&
    card.document.templateId === reusablePreviewUpgrade.templateId &&
    card.document.templateVersion === reusablePreviewUpgrade.toVersion &&
    preview.cardId === card.id &&
    preview.cardRevision === card.revision - 1 &&
    preview.renderFingerprint ===
      inventoryPreviewFingerprint(
        reusablePreviewUpgrade.templateId,
        reusablePreviewUpgrade.fromVersion,
        1,
      ) &&
    hasNoArtworkOverlay(card)
  )
}

/**
 * Persists a template upgrade and preserves a preview only for a release whose existing-card output
 * is known to be byte-compatible. It also repairs cards migrated by the initial 2026.08.23 release.
 */
export async function upgradePersistedInventoryCardToCurrentTemplate(saved: InventoryCard) {
  const migrated = await migrateInventoryCardToCurrentTemplate(saved)
  const preview = await readInventoryPreview(saved.id)

  if (migrated !== saved) {
    if (reusablePreview(preview, saved, migrated)) {
      await saveInventoryCardSnapshot(migrated, {
        ...preview,
        cardRevision: migrated.revision,
        renderFingerprint: inventoryPreviewFingerprint(
          migrated.document.templateId,
          migrated.document.templateVersion,
          1,
        ),
      })
    } else {
      await saveInventoryCard(migrated)
    }
    return migrated
  }

  if (repairablePreview(preview, saved)) {
    await storeInventoryPreview({
      ...preview,
      cardRevision: saved.revision,
      renderFingerprint: inventoryPreviewFingerprint(
        saved.document.templateId,
        saved.document.templateVersion,
        1,
      ),
    })
  }
  return saved
}
