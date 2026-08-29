import type { InventoryCardPreview, InventoryCardSummary } from "./inventory-card"

export const inventoryPreviewFormatVersion = 2
export const inventoryPreviewExportOptions = {
  format: "webp",
  quality: 0.8,
  size: { scale: 0.5 },
} as const

export function inventoryPreviewFingerprint(
  templateId: string,
  templateVersion: string,
  formatVersion = inventoryPreviewFormatVersion,
) {
  return `${templateId}@${templateVersion}:preview-v${formatVersion}`
}

/** Legacy previews remain displayable until the card's next save replaces them with v2. */
export function inventoryPreviewMatchesCard(
  preview: InventoryCardPreview,
  card: Pick<InventoryCardSummary, "id" | "revision" | "templateId" | "templateVersion">,
) {
  if (preview.cardId !== card.id || preview.cardRevision !== card.revision) return false
  return [inventoryPreviewFormatVersion, 1].some(
    (version) =>
      preview.renderFingerprint ===
      inventoryPreviewFingerprint(card.templateId, card.templateVersion, version),
  )
}
