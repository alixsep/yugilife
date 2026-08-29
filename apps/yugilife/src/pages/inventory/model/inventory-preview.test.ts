import { describe, expect, it } from "vitest"

import {
  inventoryPreviewExportOptions,
  inventoryPreviewFingerprint,
  inventoryPreviewMatchesCard,
} from "./inventory-preview"

const card = {
  id: "card-id",
  revision: 3,
  templateId: "card/series-10",
  templateVersion: "2026.08.23",
}

describe("inventory preview format", () => {
  it("exports half-scale WebP at 80% quality", () => {
    expect(inventoryPreviewExportOptions).toStrictEqual({
      format: "webp",
      quality: 0.8,
      size: { scale: 0.5 },
    })
    expect(inventoryPreviewFingerprint(card.templateId, card.templateVersion)).toBe(
      "card/series-10@2026.08.23:preview-v2",
    )
  })

  it("keeps a matching legacy preview available until the next save", () => {
    expect(
      inventoryPreviewMatchesCard(
        {
          cardId: card.id,
          cardRevision: card.revision,
          image: new Blob(["legacy"], { type: "image/png" }),
          renderFingerprint: "card/series-10@2026.08.23:preview-v1",
        },
        card,
      ),
    ).toBe(true)
  })

  it("still rejects stale revisions and template identities", () => {
    expect(
      inventoryPreviewMatchesCard(
        {
          cardId: card.id,
          cardRevision: card.revision - 1,
          image: new Blob(["stale"], { type: "image/webp" }),
          renderFingerprint: "card/series-10@2026.08.23:preview-v2",
        },
        card,
      ),
    ).toBe(false)
  })
})
