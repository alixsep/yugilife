import { describe, expect, it } from "vitest"

import { createInitialEditorDocument } from "../../build/editor/model/editor-store"

import { migrateInventoryCardDocument } from "./inventory-card-migration"

describe("inventory card template migration", () => {
  it("advances an older same-template document and preserves authored state", () => {
    const current = createInitialEditorDocument()
    const migrated = migrateInventoryCardDocument(
      {
        ...current,
        card: { ...current.card, name: "Preserved" },
        templateVersion: "2026.08.12",
      },
      current,
    )

    expect(migrated.templateVersion).toBe(current.templateVersion)
    expect(migrated.card.name).toBe("Preserved")
  })

  it("rejects a different stable template identity", () => {
    const current = createInitialEditorDocument()
    expect(() =>
      migrateInventoryCardDocument({ ...current, templateId: "card/different" }, current),
    ).toThrow(/No migration is available/)
  })
})
