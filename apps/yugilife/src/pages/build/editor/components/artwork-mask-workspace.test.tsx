import { act } from "react"

import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"

import { ArtworkMaskWorkspace } from "./artwork-editor"

import type { ComponentProps } from "react"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it("holds the completed canvas and loader until replacement effects are ready and painted", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("createImageBitmap", () => Promise.resolve({ width: 2, height: 2, close: vi.fn() }))
  vi.stubGlobal("matchMedia", () => ({ matches: true }))
  const putImageData = vi.fn()
  const context = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    fillRect: vi.fn(),
    putImageData,
    createImageData: (width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    }),
  } as unknown as CanvasRenderingContext2D
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context)
  const element = document.createElement("div")
  const root = createRoot(element)
  const frame = {
    width: 2,
    height: 2,
    pixels: new Uint8ClampedArray(16).fill(255),
    blob: new Blob(),
  }
  const props: ComponentProps<typeof ArtworkMaskWorkspace> = {
    artwork: new Blob(),
    mask: { mode: "manual", points: [], manualMask: new Blob() },
    maskChannel: "luminance",
    processedMaskBusy: false,
    processedMaskRevision: 0,
    getProcessedMaskPixels: () => frame,
    onMaskChange: vi.fn(),
    onSelectedPinChange: vi.fn(),
    pinSize: 12,
    selectedPinId: null,
    tool: "select",
  }
  try {
    await act(async () => {
      root.render(<ArtworkMaskWorkspace {...props} />)
      await Promise.resolve()
    })
    expect(putImageData).toHaveBeenCalled()
    putImageData.mockClear()
    await act(async () => {
      root.render(
        <ArtworkMaskWorkspace
          {...props}
          mask={{ ...props.mask, manualMask: new Blob() }}
          processedMaskBusy
        />,
      )
      await Promise.resolve()
    })
    expect(putImageData).not.toHaveBeenCalled()
    expect(element.querySelector('[aria-label="Updating mask preview"]')).not.toBeNull()
    // Worker completion alone must not hide the loader before the canvas effect publishes.
    act(() => {
      root.render(<ArtworkMaskWorkspace {...props} processedMaskRevision={1} />)
    })
    expect(element.querySelector("svg[aria-label]")).not.toBeNull()
    await act(async () => {
      await Promise.resolve()
    })
    expect(putImageData).toHaveBeenCalled()
    expect(element.querySelector("svg[aria-label]")).toBeNull()
  } finally {
    act(() => root.unmount())
  }
})
