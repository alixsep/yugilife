import { describe, expect, it } from "vitest"

import { inventoryPreviewExportOptions, inventoryPreviewMatchesCard } from "./inventory-preview"

const card = { id: "card-id", revision: 3 }

function preview(overrides: Partial<{ cardId: string; cardRevision: number }> = {}) {
  return {
    cardId: card.id,
    cardRevision: card.revision,
    image: new Blob(["preview"], { type: "image/webp" }),
    ...overrides,
  }
}

describe("inventory preview format", () => {
  it("exports half-scale WebP at 80% quality", () => {
    expect(inventoryPreviewExportOptions).toStrictEqual({
      format: "webp",
      quality: 0.8,
      size: { scale: 0.5 },
    })
  })

  it("accepts the preview committed with the card's current revision", () => {
    expect(inventoryPreviewMatchesCard(preview(), card)).toBe(true)
  })

  it("rejects a preview from another card or an older revision", () => {
    expect(inventoryPreviewMatchesCard(preview({ cardId: "other" }), card)).toBe(false)
    expect(inventoryPreviewMatchesCard(preview({ cardRevision: card.revision - 1 }), card)).toBe(
      false,
    )
  })
})
