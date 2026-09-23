import { act } from "react"

import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { ImageDropzone } from "./file-upload"

import type { ReactNode } from "react"

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, ...props }: { children: ReactNode; onClick?: () => void }) => (
    <button {...props} onClick={onClick}>
      {children}
    </button>
  ),
}))
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
}))
vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: ({ confirmLabel, onConfirm }: { confirmLabel: string; onConfirm: () => void }) => (
    <button onClick={onConfirm}>{confirmLabel}</button>
  ),
}))
vi.mock("./dialog", () => {
  const Box = ({ children }: { children: ReactNode }) => <div>{children}</div>
  return {
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div role="dialog">{children}</div> : null,
    DialogContent: Box,
    DialogDescription: Box,
    DialogFooter: Box,
    DialogHeader: Box,
    DialogTitle: Box,
  }
})

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("requestAnimationFrame", () => 1)
  vi.stubGlobal("cancelAnimationFrame", () => {})
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test")
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})
function click(label: string) {
  ;[...document.querySelectorAll("button")].find((button) => button.textContent === label)!.click()
}
function pick(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
  Object.defineProperty(input, "files", { value: [file], configurable: true })
  input.dispatchEvent(new Event("change", { bubbles: true }))
}

it("offers undo for a confirmed removal of a stored Blob", async () => {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  const old = new Blob(["original"])
  const change = vi.fn()
  try {
    act(() =>
      root.render(<ImageDropzone actionsOverlay undoRemoval value={old} onValueChange={change} />),
    )
    await act(async () => {
      click("Remove")
      await Promise.resolve()
    })
    expect(change).toHaveBeenLastCalledWith(null)
    act(() =>
      root.render(<ImageDropzone actionsOverlay undoRemoval value={null} onValueChange={change} />),
    )
    await act(async () => {
      click("Undo removal")
      await Promise.resolve()
    })
    expect(change).toHaveBeenLastCalledWith(old)
  } finally {
    act(() => root.unmount())
  }
})

it("requires confirmation before publishing either replacement callback", async () => {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  const change = vi.fn()
  const files = vi.fn()
  const replacement = new File(["replacement"], "replacement.png", { type: "image/png" })
  try {
    act(() =>
      root.render(
        <ImageDropzone
          value={new Blob()}
          confirmReplacement="Replace the existing image and masks."
          onValueChange={change}
          onFilesSelected={files}
        />,
      ),
    )
    await act(async () => {
      pick(replacement)
      await Promise.resolve()
    })
    expect(change).not.toHaveBeenCalled()
    expect(files).not.toHaveBeenCalled()
    await act(async () => {
      click("Cancel")
      await Promise.resolve()
    })
    expect(change).not.toHaveBeenCalled()
    await act(async () => {
      pick(replacement)
      await Promise.resolve()
    })
    await act(async () => {
      click("Replace image")
      await Promise.resolve()
    })
    expect(change).toHaveBeenCalledExactlyOnceWith(replacement)
    expect(files).toHaveBeenCalledExactlyOnceWith([replacement])
  } finally {
    act(() => root.unmount())
  }
})

it("cannot publish file validation after the controlled image changes", async () => {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  let complete!: () => void
  const validation = () =>
    new Promise<void>((resolve) => {
      complete = resolve
    })
  const change = vi.fn()
  try {
    act(() =>
      root.render(
        <ImageDropzone value={new Blob()} validateFile={validation} onValueChange={change} />,
      ),
    )
    await act(async () => {
      pick(new File(["old request"], "old.png", { type: "image/png" }))
      await Promise.resolve()
    })
    act(() =>
      root.render(
        <ImageDropzone value={new Blob()} validateFile={validation} onValueChange={change} />,
      ),
    )
    await act(async () => {
      complete()
      await Promise.resolve()
    })
    expect(change).not.toHaveBeenCalled()
  } finally {
    act(() => root.unmount())
  }
})
