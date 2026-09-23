import { afterEach, describe, expect, it } from "vitest"

import { createInitialEditorDocument } from "../../build/editor/model/editor-store"

import {
  createInventoryCard,
  deleteInventoryCard,
  duplicateInventoryCard,
  listInventoryCards,
  readInventoryCard,
  readInventoryPreview,
  saveInventoryCard,
  saveInventoryCardSnapshot,
} from "./inventory-storage"

afterEach(async () => {
  await Promise.all((await listInventoryCards()).map(({ id }) => deleteInventoryCard(id)))
})

describe("inventory storage", () => {
  it("stores independent card identities and preserves artwork and previews through duplication", async () => {
    const artwork = new Blob(["artwork"], { type: "image/png" })
    const automaticMask = new Blob(["alpha"], { type: "image/png" })
    const original = await createInventoryCard(
      {
        ...createInitialEditorDocument(),
        artworkMask: {
          automaticMask,
          mode: "automatic",
          points: [{ id: 1, polarity: "keep", size: 24, x: 10, y: 12 }],
        },
        card: { ...createInitialEditorDocument().card, artwork, name: "Original" },
      },
      "Original",
    )
    await saveInventoryCardSnapshot(original, {
      cardId: original.id,
      cardRevision: original.revision,
      image: new Blob(["preview"], { type: "image/png" }),
    })
    const duplicate = await duplicateInventoryCard(original.id)
    const duplicatePreview = await readInventoryPreview(duplicate.id)

    expect(duplicate.id).not.toBe(original.id)
    expect(duplicate.title).toBe("Original copy")
    expect(await (duplicate.document.card.artwork as Blob).text()).toBe("artwork")
    expect(await duplicate.document.artworkMask.automaticMask?.text()).toBe("alpha")
    expect(duplicate.document.artworkMask.points).toHaveLength(1)
    expect(duplicatePreview).toMatchObject({
      cardId: duplicate.id,
      cardRevision: duplicate.revision,
    })
    expect(await duplicatePreview?.image.text()).toBe("preview")
    expect(await listInventoryCards()).toHaveLength(2)
  })

  it("does not attach a stale source preview to a duplicate", async () => {
    const original = await createInventoryCard(createInitialEditorDocument(), "Original")
    await saveInventoryCardSnapshot(original, {
      cardId: original.id,
      cardRevision: original.revision,
      image: new Blob(["stale-preview"], { type: "image/png" }),
    })
    // A document-only write advances the card past the preview that was committed with it.
    await saveInventoryCard({ ...original, revision: original.revision + 1 })

    const duplicate = await duplicateInventoryCard(original.id)

    expect(await readInventoryPreview(duplicate.id)).toBeUndefined()
  })

  it("updates one aggregate revision and accepts only a matching derived preview", async () => {
    const created = await createInventoryCard(createInitialEditorDocument())
    const saved = await saveInventoryCard({
      ...created,
      document: {
        ...created.document,
        card: { ...created.document.card, name: "Updated" },
      },
      revision: 2,
      title: "Updated",
      updatedAt: created.updatedAt + 1,
    })
    await saveInventoryCardSnapshot(saved, {
      cardId: saved.id,
      cardRevision: saved.revision,
      image: new Blob(["preview"], { type: "image/png" }),
    })

    expect((await readInventoryCard(saved.id))?.document.card.name).toBe("Updated")
    expect((await readInventoryPreview(saved.id))?.cardRevision).toBe(2)

    await deleteInventoryCard(saved.id)
    expect(await readInventoryCard(saved.id)).toBeUndefined()
    expect(await readInventoryPreview(saved.id)).toBeUndefined()
  })

  it("commits a card and matching preview snapshot together", async () => {
    const created = await createInventoryCard(createInitialEditorDocument())
    const snapshot = {
      ...created,
      document: {
        ...created.document,
        card: { ...created.document.card, name: "Saved snapshot" },
      },
      revision: created.revision + 1,
      title: "Saved snapshot",
      updatedAt: created.updatedAt + 1,
    }

    await saveInventoryCardSnapshot(snapshot, {
      cardId: snapshot.id,
      cardRevision: snapshot.revision,
      image: new Blob(["snapshot-preview"], { type: "image/png" }),
    })

    expect((await readInventoryCard(snapshot.id))?.document.card.name).toBe("Saved snapshot")
    expect(await (await readInventoryPreview(snapshot.id))?.image.text()).toBe("snapshot-preview")
  })

  it("keeps creation order stable when an older card is edited", async () => {
    const older = await createInventoryCard(createInitialEditorDocument(), "Older")
    const newer = await createInventoryCard(createInitialEditorDocument(), "Newer")
    await saveInventoryCard({
      ...older,
      createdAt: older.createdAt - 10,
      revision: older.revision + 1,
      updatedAt: newer.updatedAt + 100,
    })

    expect((await listInventoryCards()).map(({ title }) => title)).toEqual(["Newer", "Older"])
  })

  it("rejects a preview that does not match its card snapshot", async () => {
    const created = await createInventoryCard(createInitialEditorDocument())
    await expect(
      saveInventoryCardSnapshot(created, {
        cardId: created.id,
        cardRevision: created.revision + 1,
        image: new Blob(["mismatch"], { type: "image/png" }),
      }),
    ).rejects.toThrow(/does not match/)
  })
})
