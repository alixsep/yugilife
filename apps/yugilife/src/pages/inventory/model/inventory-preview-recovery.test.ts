import { describe, expect, it } from "vitest"

import { createInitialEditorDocument } from "../../build/editor/model/editor-store"

import { inventoryPreviewNeedsRecovery } from "./inventory-preview-recovery"

import type { InventoryCard, InventoryCardPreview } from "./inventory-card"

function card(revision: number): InventoryCard {
  return {
    createdAt: 1,
    document: createInitialEditorDocument(),
    id: "card-id",
    revision,
    title: "Card",
    updatedAt: 1,
  }
}

function preview(overrides: Partial<InventoryCardPreview> = {}): InventoryCardPreview {
  return {
    cardId: "card-id",
    cardRevision: 2,
    image: new Blob(["preview"], { type: "image/webp" }),
    renderFingerprint: "card/series-10@2026.08.30:preview-v2",
    ...overrides,
  }
}

describe("inventory preview recovery", () => {
  it("leaves a matching preview alone", () => {
    expect(inventoryPreviewNeedsRecovery(preview(), card(2))).toBe(false)
  })

  it("recovers stale preview metadata and missing previews", () => {
    expect(
      inventoryPreviewNeedsRecovery(
        preview({ renderFingerprint: "card/series-10@2026.08.23:preview-v2" }),
        card(2),
      ),
    ).toBe(true)
    expect(inventoryPreviewNeedsRecovery(undefined, card(2))).toBe(true)
    expect(inventoryPreviewNeedsRecovery(undefined, card(1))).toBe(true)
  })
})
