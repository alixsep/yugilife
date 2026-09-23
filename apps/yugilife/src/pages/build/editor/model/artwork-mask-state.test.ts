import { beforeEach, expect, it } from "vitest"

import { serializeEditorDocument } from "../persistence/editor-document-io"

import { requireCompletedArtworkMask, selectedArtworkMask } from "./artwork-mask-state"
import { editorArtworkField } from "./editor-config"
import { useEditorStore } from "./editor-store"

beforeEach(() => useEditorStore.getState().reset())

it("invalidates old coverage immediately and blocks durable operations until matching pins complete", async () => {
  const artwork = new Blob(["art"])
  const oldMask = new Blob(["old mask"])
  const points = [{ id: 1, x: 10, y: 10, size: 24, polarity: "keep" as const }]
  useEditorStore
    .getState()
    .applyCardPatchWithArtworkMask({ artwork }, { mode: "manual", points, manualMask: oldMask })
  const newPoints = [{ ...points[0]!, x: 20 }]
  useEditorStore
    .getState()
    .setArtworkMask({ ...useEditorStore.getState().artworkMask, points: newPoints })
  expect(selectedArtworkMask(useEditorStore.getState().artworkMask)).toBeUndefined()
  expect(() => requireCompletedArtworkMask(useEditorStore.getState(), editorArtworkField)).toThrow(
    /dot mask/,
  )
  await expect(serializeEditorDocument(useEditorStore.getState())).rejects.toThrow(/dot mask/)
  useEditorStore.getState().completeArtworkMask(artwork, points, oldMask)
  expect(useEditorStore.getState().artworkMask.manualMask).toBeUndefined()
  const newMask = new Blob(["new mask"])
  useEditorStore.getState().completeArtworkMask(artwork, newPoints, newMask)
  expect(useEditorStore.getState().artworkMask.manualMask).toBe(newMask)
  expect(() =>
    requireCompletedArtworkMask(useEditorStore.getState(), editorArtworkField),
  ).not.toThrow()
})

it("rejects a completion from a previous artwork and preserves inactive image masks", () => {
  const artwork = new Blob()
  const automaticMask = new Blob()
  const points = [{ id: 1, x: 1, y: 1, size: 4, polarity: "keep" as const }]
  useEditorStore
    .getState()
    .applyCardPatchWithArtworkMask({ artwork }, { automaticMask, mode: "manual", points })
  useEditorStore.getState().completeArtworkMask(new Blob(), points, new Blob())
  expect(useEditorStore.getState().artworkMask.manualMask).toBeUndefined()
  useEditorStore
    .getState()
    .setArtworkMask({ ...useEditorStore.getState().artworkMask, mode: "automatic" })
  expect(selectedArtworkMask(useEditorStore.getState().artworkMask)).toBe(automaticMask)
  expect(() =>
    requireCompletedArtworkMask(useEditorStore.getState(), editorArtworkField),
  ).not.toThrow()
})
