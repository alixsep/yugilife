import { act } from "react"

import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { useEditorStore } from "../../editor/model/editor-store"

import { CatalogArtworkRecovery } from "./catalog-artwork-recovery"

import type { ReactNode } from "react"

const load = vi.hoisted(() => ({ alpha: vi.fn(), all: vi.fn() }))
vi.mock("../model/card-artwork-loader", () => ({
  loadCardArtworkAlpha: load.alpha,
  loadCardArtworks: load.all,
}))
vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: ({ onConfirm, title }: { onConfirm: () => void; title: string }) => (
    <button onClick={onConfirm}>{title}</button>
  ),
}))
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}))

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  useEditorStore.getState().reset()
  useEditorStore.getState().applyCardPatchWithArtworkMask(
    { artwork: new Blob(["custom art"]), name: "My authored name" },
    {
      catalogSource: { artworkId: 123, cardCid: 456, name: "Database name" },
      automaticMask: new Blob(["custom mask"]),
      manualMask: new Blob(["manual"]),
      mode: "automatic",
      points: [{ id: 1, x: 5, y: 8, size: 24, polarity: "keep" }],
    },
  )
})
afterEach(() => {
  load.alpha.mockReset()
  load.all.mockReset()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

function renderRecovery() {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  const state = useEditorStore.getState()
  act(() =>
    root.render(
      <CatalogArtworkRecovery
        mask={state.artworkMask}
        applyPatch={state.applyCardPatchWithArtworkMask}
        onMaskChange={state.setArtworkMask}
      />,
    ),
  )
  return root
}
function click(label: string) {
  ;[...document.querySelectorAll("button")].find((button) => button.textContent === label)!.click()
}

it("shows compact, stacked recovery actions without exposing catalog source metadata", () => {
  const root = renderRecovery()
  try {
    expect(document.body.textContent).not.toContain("Database source")
    expect([...document.querySelectorAll("button")].map(({ textContent }) => textContent)).toEqual([
      "Restore artwork?",
      "Restore image mask?",
      "Restore pins?",
    ])
    expect(document.querySelector('[role="group"]')?.className).toContain("grid")
  } finally {
    act(() => root.unmount())
  }
})

it("restores only the image mask without fetching RGB or replacing authored text, artwork, or pins", async () => {
  const before = useEditorStore.getState()
  const mask = new Blob(["database mask"])
  load.alpha.mockResolvedValue({ alphaMask: mask, maskPoints: [] })
  const root = renderRecovery()
  try {
    await act(async () => {
      click("Restore image mask?")
      await Promise.resolve()
    })
    const after = useEditorStore.getState()
    expect(after.card).toBe(before.card)
    expect(after.artworkMask.points).toBe(before.artworkMask.points)
    expect(after.artworkMask.manualMask).toBe(before.artworkMask.manualMask)
    expect(after.artworkMask.automaticMask).toBe(mask)
    expect(load.all).not.toHaveBeenCalled()
  } finally {
    act(() => root.unmount())
  }
})

it("does not overwrite edits made during a database download", async () => {
  let complete!: (value: { alphaMask: Blob }) => void
  load.alpha.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  const root = renderRecovery()
  try {
    await act(async () => {
      click("Restore image mask?")
      await Promise.resolve()
    })
    const mask = new Blob(["new user mask"])
    useEditorStore
      .getState()
      .setArtworkMask({ ...useEditorStore.getState().artworkMask, automaticMask: mask })
    await act(async () => {
      complete({ alphaMask: new Blob(["database"]) })
      await Promise.resolve()
    })
    expect(useEditorStore.getState().artworkMask.automaticMask).toBe(mask)
    expect(document.body.textContent).toContain("Nothing was replaced")
  } finally {
    act(() => root.unmount())
  }
})

it("preserves the current mask when the database has no alpha bundle", async () => {
  const before = useEditorStore.getState().artworkMask
  load.alpha.mockResolvedValue(undefined)
  const root = renderRecovery()
  try {
    await act(async () => {
      click("Restore image mask?")
      await Promise.resolve()
    })
    expect(useEditorStore.getState().artworkMask).toBe(before)
    expect(document.body.textContent).toContain("not available")
  } finally {
    act(() => root.unmount())
  }
})
