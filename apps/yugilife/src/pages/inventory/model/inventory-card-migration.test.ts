import { afterEach, describe, expect, it } from "vitest"

import { createInitialEditorDocument } from "../../build/editor/model/editor-store"
import {
  createInventoryCard,
  deleteInventoryCard,
  listInventoryCards,
  readInventoryCard,
} from "../persistence/inventory-storage"

import {
  migrateInventoryCardDocument,
  migrateInventoryCardToCurrentTemplate,
} from "./inventory-card-migration"

afterEach(async () => {
  await Promise.all((await listInventoryCards()).map(({ id }) => deleteInventoryCard(id)))
})

describe("inventory card template migration", () => {
  it("advances an older same-template document and preserves authored state", () => {
    const current = createInitialEditorDocument()
    const migrated = migrateInventoryCardDocument(
      {
        ...current,
        card: { ...current.card, name: "Preserved" },
        templateVersion: "2026.08.30",
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

  it("moves legacy mask effects out of inventory presentation overrides", () => {
    const current = createInitialEditorDocument()
    const migrated = migrateInventoryCardDocument(
      {
        ...current,
        presentationOverrides: {
          artworkMaskEffects: { artworkOverlay: { antiAlias: true, glow: 4 } },
        },
      } as never,
      current,
    )

    expect(migrated.artworkMaskEffects).toEqual({
      artworkOverlay: { antiAlias: true, glow: 4 },
    })
    expect(migrated.presentationOverrides).toEqual({})
  })

  it("migrates legacy inventory full-art state without losing its crop", () => {
    const current = createInitialEditorDocument()
    const migrated = migrateInventoryCardDocument(
      {
        ...current,
        presentationOverrides: {
          artworkTransforms: {
            artwork: { fullArt: true, scale: 1.8, x: 0.1, y: -0.2 },
          },
        },
      } as never,
      current,
    )

    expect(migrated.presentationOverrides.artworkTransforms?.artwork).toEqual({
      mode: "full-art",
      scale: 1.8,
      x: 0.1,
      y: -0.2,
    })
  })

  it("removes the retired Link-arrow mask override before validating an inventory card", () => {
    const current = createInitialEditorDocument()
    const migrated = migrateInventoryCardDocument(
      {
        ...current,
        card: { ...current.card, cardVariant: "link" },
        presentationOverrides: {
          layerMasks: {
            artworkOverlay: "full-art-coverage",
            linkArrowLayers: "link-arrows",
          },
        },
        templateVersion: "2026.08.30",
      },
      current,
    )

    expect(migrated.presentationOverrides.layerMasks).toEqual({
      artworkOverlay: "full-art-coverage",
    })
    expect(migrated.card.cardVariant).toBe("link")
    expect(migrated.templateVersion).toBe(current.templateVersion)
  })
})

describe("inventory card migration is a pure read", () => {
  it("returns a migrated card without writing it back", async () => {
    const current = createInitialEditorDocument()
    const saved = await createInventoryCard({ ...current, templateVersion: "2026.08.30" })

    const migrated = await migrateInventoryCardToCurrentTemplate(saved)

    expect(migrated.document.templateVersion).toBe(current.templateVersion)
    expect(migrated.revision).toBe(saved.revision + 1)
    // Nothing is persisted here: the caller commits the card and its rendered preview together, so
    // a migration can never reach storage without the thumbnail that depicts it.
    const stored = await readInventoryCard(saved.id)
    expect(stored?.document.templateVersion).toBe("2026.08.30")
    expect(stored?.revision).toBe(saved.revision)
  })

  it("preserves artwork and its mask while migrating an overlay-bearing card", async () => {
    const current = createInitialEditorDocument()
    const artwork = new Blob(["artwork"], { type: "image/png" })
    const artworkOverlay = new Blob(["overlay"], { type: "image/png" })
    const saved = await createInventoryCard({
      ...current,
      card: { ...current.card, artwork, artworkOverlay },
      templateVersion: "2026.08.30",
    })

    const migrated = await migrateInventoryCardToCurrentTemplate(saved)

    expect(migrated.document.card.artwork).toBe(artwork)
    expect(migrated.document.card.artworkOverlay).toBe(artworkOverlay)
    expect(migrated.document.templateVersion).toBe(current.templateVersion)
  })

  it("leaves a card on the current template untouched", async () => {
    const saved = await createInventoryCard(createInitialEditorDocument())
    expect(await migrateInventoryCardToCurrentTemplate(saved)).toBe(saved)
  })
})
