import { afterEach, describe, expect, it } from "vitest"

import { createInitialEditorDocument } from "../../build/editor/model/editor-store"
import {
  createInventoryCard,
  deleteInventoryCard,
  listInventoryCards,
  readInventoryCard,
  readInventoryPreview,
  saveInventoryCard,
  storeInventoryPreview,
} from "../persistence/inventory-storage"

import { upgradePersistedInventoryCardToCurrentTemplate } from "./inventory-card-upgrade"

afterEach(async () => {
  await Promise.all((await listInventoryCards()).map(({ id }) => deleteInventoryCard(id)))
})

describe("persisted inventory card template upgrades", () => {
  it("preserves a matching preview for the visually compatible Series 10 upgrade", async () => {
    const current = createInitialEditorDocument()
    const saved = await createInventoryCard({ ...current, templateVersion: "2026.08.15" })
    await storeInventoryPreview({
      cardId: saved.id,
      cardRevision: saved.revision,
      image: new Blob(["preview"], { type: "image/png" }),
      renderFingerprint: "card/series-10@2026.08.15:preview-v1",
    })

    const upgraded = await upgradePersistedInventoryCardToCurrentTemplate(saved)
    const preview = await readInventoryPreview(saved.id)

    expect(upgraded.document.templateVersion).toBe("2026.08.30")
    expect(preview).toMatchObject({
      cardRevision: upgraded.revision,
      renderFingerprint: "card/series-10@2026.08.30:preview-v1",
    })
    expect(await preview?.image.text()).toBe("preview")
  })

  it("preserves the current preview format from the immediately previous template", async () => {
    const current = createInitialEditorDocument()
    const saved = await createInventoryCard({ ...current, templateVersion: "2026.08.23" })
    await storeInventoryPreview({
      cardId: saved.id,
      cardRevision: saved.revision,
      image: new Blob(["preview-v2"], { type: "image/webp" }),
      renderFingerprint: "card/series-10@2026.08.23:preview-v2",
    })

    const upgraded = await upgradePersistedInventoryCardToCurrentTemplate(saved)

    expect(await readInventoryPreview(saved.id)).toMatchObject({
      cardRevision: upgraded.revision,
      renderFingerprint: "card/series-10@2026.08.30:preview-v2",
    })
  })

  it("preserves an 08.23 preview containing an artwork overlay", async () => {
    const current = createInitialEditorDocument()
    const saved = await createInventoryCard({
      ...current,
      card: { ...current.card, artworkOverlay: new Blob(["overlay"], { type: "image/png" }) },
      templateVersion: "2026.08.23",
    })
    await storeInventoryPreview({
      cardId: saved.id,
      cardRevision: saved.revision,
      image: new Blob(["preview-v2"], { type: "image/webp" }),
      renderFingerprint: "card/series-10@2026.08.23:preview-v2",
    })

    const upgraded = await upgradePersistedInventoryCardToCurrentTemplate(saved)

    expect(await readInventoryPreview(saved.id)).toMatchObject({
      cardRevision: upgraded.revision,
      renderFingerprint: "card/series-10@2026.08.30:preview-v2",
    })
  })

  it("repairs previews invalidated by the initial Series 10 upgrade", async () => {
    const current = createInitialEditorDocument()
    const affected = await createInventoryCard(current)
    await saveInventoryCard({ ...affected, revision: 2 })
    await storeInventoryPreview({
      cardId: affected.id,
      cardRevision: 1,
      image: new Blob(["preview"], { type: "image/png" }),
      renderFingerprint: "card/series-10@2026.08.15:preview-v1",
    })

    const saved = await readInventoryCard(affected.id)
    expect(saved).toBeDefined()
    await upgradePersistedInventoryCardToCurrentTemplate(saved!)

    expect(await readInventoryPreview(affected.id)).toMatchObject({
      cardRevision: 2,
      renderFingerprint: "card/series-10@2026.08.30:preview-v1",
    })
  })

  it("repairs a v2 preview left behind by the 2026.08.23 upgrade", async () => {
    const current = createInitialEditorDocument()
    const affected = await createInventoryCard(current)
    await saveInventoryCard({ ...affected, revision: 2 })
    await storeInventoryPreview({
      cardId: affected.id,
      cardRevision: 1,
      image: new Blob(["preview-v2"], { type: "image/webp" }),
      renderFingerprint: "card/series-10@2026.08.23:preview-v2",
    })

    const saved = await readInventoryCard(affected.id)
    expect(saved).toBeDefined()
    await upgradePersistedInventoryCardToCurrentTemplate(saved!)

    expect(await readInventoryPreview(affected.id)).toMatchObject({
      cardRevision: 2,
      renderFingerprint: "card/series-10@2026.08.30:preview-v2",
    })
  })

  it("repairs a compatible preview stranded across two template upgrades", async () => {
    const current = createInitialEditorDocument()
    const affected = await createInventoryCard(current)
    await saveInventoryCard({ ...affected, revision: 3 })
    await storeInventoryPreview({
      cardId: affected.id,
      cardRevision: 1,
      image: new Blob(["preview-v1"], { type: "image/png" }),
      renderFingerprint: "card/series-10@2026.08.15:preview-v1",
    })

    const saved = await readInventoryCard(affected.id)
    expect(saved).toBeDefined()
    await upgradePersistedInventoryCardToCurrentTemplate(saved!)

    expect(await readInventoryPreview(affected.id)).toMatchObject({
      cardRevision: 3,
      renderFingerprint: "card/series-10@2026.08.30:preview-v1",
    })
  })

  it("does not reuse an old preview when an artwork overlay is present", async () => {
    const current = createInitialEditorDocument()
    const saved = await createInventoryCard({
      ...current,
      card: { ...current.card, artworkOverlay: new Blob(["overlay"], { type: "image/png" }) },
      templateVersion: "2026.08.15",
    })
    await storeInventoryPreview({
      cardId: saved.id,
      cardRevision: saved.revision,
      image: new Blob(["preview"], { type: "image/png" }),
      renderFingerprint: "card/series-10@2026.08.15:preview-v1",
    })

    await upgradePersistedInventoryCardToCurrentTemplate(saved)

    expect(await readInventoryPreview(saved.id)).toMatchObject({
      cardRevision: saved.revision,
      renderFingerprint: "card/series-10@2026.08.15:preview-v1",
    })
  })
})
