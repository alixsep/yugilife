import {
  readInventoryPreview,
  saveInventoryCard,
  saveInventoryCardSnapshot,
  storeInventoryPreview,
} from "../persistence/inventory-storage"

import { migrateInventoryCardToCurrentTemplate } from "./inventory-card-migration"
import { inventoryPreviewFingerprint, inventoryPreviewFormatVersion } from "./inventory-preview"

import type { InventoryCard, InventoryCardPreview } from "./inventory-card"

const reusablePreviewUpgrade = {
  sources: {
    "2026.08.15": { repairRevisionDeltas: [1, 2], requiresNoArtworkOverlay: true },
    "2026.08.23": { repairRevisionDeltas: [1], requiresNoArtworkOverlay: false },
  },
  templateId: "card/series-10",
  toVersion: "2026.08.30",
} as const

const reusablePreviewFormatVersions = [inventoryPreviewFormatVersion, 1] as const

function hasNoArtworkOverlay(card: InventoryCard) {
  const overlay = card.document.card.artworkOverlay
  return overlay === undefined || overlay === ""
}

function reusablePreviewSource(templateVersion: string) {
  if (!(templateVersion in reusablePreviewUpgrade.sources)) return undefined
  return reusablePreviewUpgrade.sources[
    templateVersion as keyof typeof reusablePreviewUpgrade.sources
  ]
}

function reusablePreviewFormat(
  preview: InventoryCardPreview | undefined,
  cardId: string,
  cardRevision: number,
  templateVersion: string,
) {
  if (
    !preview ||
    preview.cardId !== cardId ||
    preview.cardRevision !== cardRevision ||
    !reusablePreviewSource(templateVersion)
  ) {
    return undefined
  }
  return reusablePreviewFormatVersions.find(
    (version) =>
      preview.renderFingerprint ===
      inventoryPreviewFingerprint(reusablePreviewUpgrade.templateId, templateVersion, version),
  )
}

function reusablePreviewFormatForUpgrade(
  preview: InventoryCardPreview | undefined,
  source: InventoryCard,
  target: InventoryCard,
) {
  if (
    source.document.templateId !== reusablePreviewUpgrade.templateId ||
    target.document.templateId !== reusablePreviewUpgrade.templateId ||
    target.document.templateVersion !== reusablePreviewUpgrade.toVersion ||
    (reusablePreviewSource(source.document.templateVersion)?.requiresNoArtworkOverlay === true &&
      !hasNoArtworkOverlay(target))
  ) {
    return undefined
  }
  return reusablePreviewFormat(preview, source.id, source.revision, source.document.templateVersion)
}

function repairablePreviewFormat(preview: InventoryCardPreview | undefined, card: InventoryCard) {
  if (
    !preview ||
    card.document.templateId !== reusablePreviewUpgrade.templateId ||
    card.document.templateVersion !== reusablePreviewUpgrade.toVersion
  ) {
    return undefined
  }
  for (const [fromVersion, source] of Object.entries(reusablePreviewUpgrade.sources)) {
    if (source.requiresNoArtworkOverlay && !hasNoArtworkOverlay(card)) continue
    for (const revisionDelta of source.repairRevisionDeltas) {
      const format = reusablePreviewFormat(
        preview,
        card.id,
        card.revision - revisionDelta,
        fromVersion,
      )
      if (format !== undefined) return format
    }
  }
  return undefined
}

/**
 * Persists a template upgrade and preserves a preview only for a release whose existing-card output
 * is known to be byte-compatible. It also repairs cards migrated by the initial 2026.08.23 release.
 * The default-hidden sticker additions preserve that compatibility through 2026.08.30.
 */
export async function upgradePersistedInventoryCardToCurrentTemplate(saved: InventoryCard) {
  const migrated = await migrateInventoryCardToCurrentTemplate(saved)
  const preview = await readInventoryPreview(saved.id)

  if (migrated !== saved) {
    const previewFormat = reusablePreviewFormatForUpgrade(preview, saved, migrated)
    if (preview && previewFormat !== undefined) {
      await saveInventoryCardSnapshot(migrated, {
        ...preview,
        cardRevision: migrated.revision,
        renderFingerprint: inventoryPreviewFingerprint(
          migrated.document.templateId,
          migrated.document.templateVersion,
          previewFormat,
        ),
      })
    } else {
      await saveInventoryCard(migrated)
    }
    return migrated
  }

  const repairFormat = repairablePreviewFormat(preview, saved)
  if (preview && repairFormat !== undefined) {
    await storeInventoryPreview({
      ...preview,
      cardRevision: saved.revision,
      renderFingerprint: inventoryPreviewFingerprint(
        saved.document.templateId,
        saved.document.templateVersion,
        repairFormat,
      ),
    })
  }
  return saved
}
