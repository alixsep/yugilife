import type { InventoryCardPreview, InventoryCardSummary } from "./inventory-card"

export const inventoryPreviewExportOptions = {
  format: "webp",
  quality: 0.8,
  size: { scale: 0.5 },
} as const

/**
 * A preview is identified by the exact card revision it was rendered from, and nothing else.
 *
 * It carries no template fingerprint because it cannot disagree with its card: every write goes
 * through `saveInventoryCardSnapshot`, which commits the document and its preview in one IndexedDB
 * transaction. A document can only reach a new template version by being migrated, and migration
 * commits a freshly rendered preview in that same transaction, so "which template rendered this"
 * is already answered by "which revision rendered this".
 */
export function inventoryPreviewMatchesCard(
  preview: InventoryCardPreview,
  card: Pick<InventoryCardSummary, "id" | "revision">,
) {
  return preview.cardId === card.id && preview.cardRevision === card.revision
}
