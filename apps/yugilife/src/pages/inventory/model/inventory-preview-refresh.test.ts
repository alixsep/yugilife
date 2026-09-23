import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createInitialEditorDocument } from "../../build/editor/model/editor-store"
import {
  createInventoryCard,
  deleteInventoryCard,
  listInventoryCards,
  readInventoryCard,
  readInventoryPreview,
} from "../persistence/inventory-storage"

import { refreshInventoryPreviews } from "./inventory-preview-refresh"

import type { InventoryPreviewRefreshProgress } from "./inventory-preview-refresh"
import type * as TemplatesModule from "yugilife-templates"

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  render: vi.fn(),
}))

vi.mock("yugilife-templates", async (importOriginal) => {
  const actual = await importOriginal<typeof TemplatesModule>()
  return { ...actual, getOfficialTemplate: () => ({ load: mocks.load }) }
})
vi.mock("./inventory-preview-render", () => ({
  processedInventoryMask: () => Promise.resolve(undefined),
  renderInventoryPreview: mocks.render,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.load.mockResolvedValue({ template: {}, manifest: {}, assets: {}, colorPresets: {} })
  mocks.render.mockResolvedValue(new Blob(["preview"], { type: "image/webp" }))
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all((await listInventoryCards()).map(({ id }) => deleteInventoryCard(id)))
})

describe("inventory preview refresh", () => {
  it("loads one template bundle for the whole collection rather than one per card", async () => {
    await createInventoryCard(createInitialEditorDocument(), "First")
    await createInventoryCard(createInitialEditorDocument(), "Second")

    const result = await refreshInventoryPreviews()

    expect(result).toEqual({ failed: [], updated: 2 })
    expect(mocks.render).toHaveBeenCalledTimes(2)
    // The bundle is the expensive part: loading it per card is what made the old pipeline unusable.
    expect(mocks.load).toHaveBeenCalledTimes(1)
  })

  it("commits a preview without reporting an up-to-date card as edited", async () => {
    const card = await createInventoryCard(createInitialEditorDocument(), "Current")

    await refreshInventoryPreviews()

    const stored = await readInventoryCard(card.id)
    expect(stored?.revision).toBe(card.revision)
    expect(stored?.updatedAt).toBe(card.updatedAt)
    expect(await readInventoryPreview(card.id)).toMatchObject({
      cardId: card.id,
      cardRevision: card.revision,
    })
  })

  it("reports a failed card by title and still refreshes the rest", async () => {
    await createInventoryCard(createInitialEditorDocument(), "First")
    await createInventoryCard(createInitialEditorDocument(), "Second")
    mocks.render
      .mockRejectedValueOnce(new Error("render failed"))
      .mockResolvedValueOnce(new Blob(["preview"], { type: "image/webp" }))

    const result = await refreshInventoryPreviews()

    expect(result.updated).toBe(1)
    expect(result.failed).toHaveLength(1)
  })

  it("announces each card as its own preview is committed", async () => {
    const first = await createInventoryCard(createInitialEditorDocument(), "First")
    const second = await createInventoryCard(createInitialEditorDocument(), "Second")
    const rendered: string[] = []

    await refreshInventoryPreviews({ onCardRendered: (cardId) => rendered.push(cardId) })

    expect(new Set(rendered)).toEqual(new Set([first.id, second.id]))
  })

  it("does not announce a card whose render failed", async () => {
    await createInventoryCard(createInitialEditorDocument(), "First")
    await createInventoryCard(createInitialEditorDocument(), "Second")
    mocks.render.mockRejectedValueOnce(new Error("render failed"))
    const rendered: string[] = []

    const result = await refreshInventoryPreviews({
      onCardRendered: (cardId) => rendered.push(cardId),
    })

    expect(rendered).toHaveLength(1)
    expect(result.failed).toHaveLength(1)
  })

  it("reports progress from zero through every card, naming the one being rendered", async () => {
    const first = await createInventoryCard(createInitialEditorDocument(), "First")
    const second = await createInventoryCard(createInitialEditorDocument(), "Second")
    const progress: InventoryPreviewRefreshProgress[] = []

    await refreshInventoryPreviews({ onProgress: (update) => progress.push(update) })

    expect(progress.map(({ completed }) => completed)).toEqual([0, 0, 1, 2])
    expect(progress.every(({ total }) => total === 2)).toBe(true)
    // The boundaries name no card; each card is announced before its own render.
    expect(progress.map(({ cardId }) => cardId !== undefined)).toEqual([false, true, true, false])
    expect(new Set(progress.slice(1, 3).map(({ cardId }) => cardId))).toEqual(
      new Set([first.id, second.id]),
    )
  })
})
