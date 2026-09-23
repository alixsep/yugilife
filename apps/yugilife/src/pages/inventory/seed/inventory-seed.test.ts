import { afterEach, describe, expect, it, vi } from "vitest"

import { validateEditorDocumentState } from "../../build/editor/model/editor-document-validation"
import { useEditorStore } from "../../build/editor/model/editor-store"

import { createInventorySeed } from "./inventory-seed"

afterEach(() => {
  useEditorStore.getState().reset()
  vi.unstubAllGlobals()
})

describe("starter inventory", () => {
  it("builds eight valid, previewed cards spanning the major Series 10 families", async () => {
    const fetchAsset = vi.fn((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      return Promise.resolve(
        new Response(url, {
          headers: { "content-type": "image/webp" },
        }),
      )
    })
    vi.stubGlobal("fetch", fetchAsset)
    useEditorStore.getState().setField("name", "Unsaved private draft")

    const seed = await createInventorySeed()

    expect(seed).toHaveLength(8)
    expect(useEditorStore.getState().card.name).toBe("Unsaved private draft")
    expect(fetchAsset).toHaveBeenCalledTimes(16)
    expect(new Set(seed.map(({ card }) => card.id)).size).toBe(8)
    expect(seed.map(({ card }) => card.document.card.cardVariant)).toEqual([
      "normal",
      "effect",
      "fusion",
      "synchro",
      "xyz",
      "link",
      "spell",
      "trap",
    ])
    seed.forEach(({ card, preview }) => {
      expect(() => validateEditorDocumentState(card.document)).not.toThrow()
      expect(card.document.card.artwork).toBeInstanceOf(Blob)
      expect(preview).toMatchObject({ cardId: card.id, cardRevision: card.revision })
      expect(preview.image.type).toBe("image/webp")
    })
  })
})
