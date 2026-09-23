import { act } from "react"

import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { previewUpdateDescription, useInventoryController } from "./use-inventory-controller"

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  readPreview: vi.fn(),
  refreshPreviews: vi.fn(),
  matches: vi.fn(),
}))
vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }))
vi.mock("./inventory-initialization", () => ({ initializeInventory: mocks.initialize }))
vi.mock("./model/inventory-preview", () => ({ inventoryPreviewMatchesCard: mocks.matches }))
vi.mock("./model/inventory-preview-refresh", () => ({
  refreshInventoryPreviews: mocks.refreshPreviews,
}))
vi.mock("./persistence/inventory-storage", () => ({
  readInventoryPreview: mocks.readPreview,
  getInventoryStorageMode: () => "memory",
  createInventoryCard: vi.fn(),
  deleteInventoryCard: vi.fn(),
  duplicateInventoryCard: vi.fn(),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}

function Harness() {
  useInventoryController()
  return null
}

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

it("stops reading previews after navigating away instead of walking the rest of the inventory", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:staged"), revokeObjectURL: vi.fn() })
  const pending = deferred<undefined>()
  mocks.initialize.mockResolvedValue(["a", "b", "c"].map((id) => ({ id, createdAt: 0 })))
  mocks.matches.mockReturnValue(true)
  mocks.readPreview
    .mockResolvedValueOnce({ image: new Blob() })
    .mockReturnValueOnce(pending.promise)
  const root = createRoot(document.createElement("div"))
  act(() => {
    root.render(<Harness />)
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
  expect(mocks.readPreview).toHaveBeenCalledTimes(2)
  act(() => {
    root.unmount()
  })
  pending.resolve(undefined)
  await act(async () => {
    await pending.promise
  })
  // The third card is never read: the loop checks for cancellation before continuing.
  expect(mocks.readPreview).toHaveBeenCalledTimes(2)
})

it("revokes staged preview URLs if navigation interrupts their publication", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const createObjectURL = vi.fn(() => "blob:staged")
  const revokeObjectURL = vi.fn()
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL })
  const pending = deferred<undefined>()
  mocks.initialize.mockResolvedValue([
    { id: "a", createdAt: 0 },
    { id: "b", createdAt: 0 },
  ])
  mocks.matches.mockReturnValue(true)
  mocks.readPreview
    .mockResolvedValueOnce({ image: new Blob() })
    .mockReturnValueOnce(pending.promise)
  const root = createRoot(document.createElement("div"))
  act(() => {
    root.render(<Harness />)
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
  expect(createObjectURL).toHaveBeenCalledOnce()
  act(() => {
    root.unmount()
  })
  pending.resolve(undefined)
  await act(async () => {
    await pending.promise
  })
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:staged")
})

describe("update-previews confirmation copy", () => {
  it("says nothing needs regenerating when every preview is current", () => {
    expect(previewUpdateDescription(12, { outdated: 0, templateUpgrade: undefined })).toBe(
      "All 12 previews already match their saved cards. Updating re-renders every card anyway, which can take a while.",
    )
    expect(previewUpdateDescription(1, { outdated: 0, templateUpgrade: undefined })).toBe(
      "This card's preview already matches its saved card. Updating re-renders it anyway.",
    )
  })

  it("counts the outdated cards and names the template they move to", () => {
    expect(previewUpdateDescription(12, { outdated: 3, templateUpgrade: "2026.09.16" })).toBe(
      "3 of 12 cards need a new preview. Cards on an older template are updated to 2026.09.16. Every card is re-rendered, which can take a while.",
    )
  })

  it("omits the template line when no card is behind its template", () => {
    expect(previewUpdateDescription(4, { outdated: 1, templateUpgrade: undefined })).toBe(
      "1 of 4 cards needs a new preview. Every card is re-rendered, which can take a while.",
    )
  })
})
