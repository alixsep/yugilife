import { afterEach, describe, expect, it, vi } from "vitest"

import { createInitialEditorDocument } from "../../build/editor/model/editor-store"

import type { InventorySeedSnapshot } from "./inventory-storage"

function snapshot(id: string, title = "Starter card"): InventorySeedSnapshot {
  const document = createInitialEditorDocument()
  return {
    card: {
      createdAt: 1,
      document: { ...document, card: { ...document.card, name: title } },
      id,
      revision: 1,
      title,
      updatedAt: 1,
    },
    preview: {
      cardId: id,
      cardRevision: 1,
      image: new Blob(["preview"], { type: "image/png" }),
      renderFingerprint: `${document.templateId}@${document.templateVersion}:preview-v1`,
    },
  }
}

async function freshMemoryStorage() {
  vi.stubGlobal("indexedDB", undefined)
  vi.resetModules()
  return import("./inventory-storage")
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("inventory bootstrap", () => {
  it("installs a starter collection once and never resurrects it after deletion", async () => {
    const storage = await freshMemoryStorage()
    const createSeed = vi.fn(() => Promise.resolve([snapshot("starter-1")]))

    await expect(storage.seedInventoryIfPristine(createSeed)).resolves.toBe(true)
    await expect(storage.seedInventoryIfPristine(createSeed)).resolves.toBe(false)
    expect(createSeed).toHaveBeenCalledTimes(1)
    expect(await storage.listInventoryCards()).toHaveLength(1)

    await storage.deleteInventoryCard("starter-1")
    await expect(storage.seedInventoryIfPristine(createSeed)).resolves.toBe(false)
    expect(await storage.listInventoryCards()).toHaveLength(0)
  })

  it("never adds samples to an inventory that already contains user data", async () => {
    const storage = await freshMemoryStorage()
    const initial = createInitialEditorDocument()
    const authored = { ...initial, card: { ...initial.card, name: "Do not replace me" } }
    const userCard = await storage.createInventoryCard(authored, "User card")
    const createSeed = vi.fn(() => Promise.resolve([snapshot("starter-1")]))

    await expect(storage.seedInventoryIfPristine(createSeed)).resolves.toBe(false)
    expect(createSeed).not.toHaveBeenCalled()
    expect((await storage.readInventoryCard(userCard.id))?.document.card.name).toBe(
      "Do not replace me",
    )
  })

  it("leaves initialization pending when seed preparation fails", async () => {
    const storage = await freshMemoryStorage()

    await expect(
      storage.seedInventoryIfPristine(() => Promise.reject(new Error("asset unavailable"))),
    ).rejects.toThrow("asset unavailable")
    expect(await storage.listInventoryCards()).toHaveLength(0)
    await expect(
      storage.seedInventoryIfPristine(() => Promise.resolve([snapshot("starter-after-retry")])),
    ).resolves.toBe(true)
  })
})
