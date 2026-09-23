import { act } from "react"

import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"

import { MaskImageInput } from "./mask-image-input"

import type { ReactNode } from "react"

const mock = vi.hoisted(() => ({
  inspect: vi.fn(),
  input: undefined as undefined | { onValueChange: (blob: Blob) => void },
}))
vi.mock("@/lib/image-input", () => ({ inspectImageInput: mock.inspect }))
vi.mock("@/components/ui/file-upload", () => ({
  ImageDropzone: (props: { onValueChange: (blob: Blob) => void }) => {
    mock.input = props
    return null
  },
}))
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}))
vi.mock("@/components/ui/dialog", () => {
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

afterEach(() => {
  vi.unstubAllGlobals()
  mock.inspect.mockReset()
  document.body.replaceChildren()
})

it("requires confirmation to stretch a mismatched mask and leaves the current mask untouched on cancel", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  const onChange = vi.fn()
  const artwork = new Blob(["art"])
  const previous = new Blob(["previous"])
  const replacement = new Blob(["replacement"])
  mock.inspect.mockImplementation((blob: Blob) =>
    Promise.resolve(blob === artwork ? { width: 100, height: 200 } : { width: 50, height: 50 }),
  )
  try {
    await act(async () => {
      root.render(<MaskImageInput artwork={artwork} value={previous} onChange={onChange} />)
      await Promise.resolve()
    })
    await act(async () => {
      mock.input!.onValueChange(replacement)

      await Promise.resolve()
    })
    expect(onChange).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("50 × 50")
    expect(document.body.textContent).toContain("100 × 200")
    await act(async () => {
      ;[...document.querySelectorAll("button")]
        .find((button) => button.textContent === "Cancel")!
        .click()

      await Promise.resolve()
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => {
      mock.input!.onValueChange(replacement)

      await Promise.resolve()
    })
    await act(async () => {
      ;[...document.querySelectorAll("button")]
        .find((button) => button.textContent === "Fit and apply mask")!
        .click()

      await Promise.resolve()
    })
    expect(onChange).toHaveBeenCalledExactlyOnceWith(replacement)
  } finally {
    act(() => root.unmount())
  }
})

it("rejects undecodable masks without replacing the existing image", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  const onChange = vi.fn()
  mock.inspect.mockRejectedValue(new Error("Invalid image"))
  try {
    await act(async () => {
      root.render(<MaskImageInput artwork={new Blob()} value={new Blob()} onChange={onChange} />)
      await Promise.resolve()
    })
    await act(async () => {
      mock.input!.onValueChange(new Blob())

      await Promise.resolve()
    })
    expect(onChange).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("Invalid image")
  } finally {
    act(() => root.unmount())
  }
})
