import { act } from "react"

import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"

import { ArtworkEditor } from "./artwork-editor"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

it("downloads the completed dot mask", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect() {}
      observe() {}
      unobserve() {}
    },
  )
  const createObjectURL = vi.fn(() => "blob:dot-mask")
  const revokeObjectURL = vi.fn()
  vi.stubGlobal(
    "URL",
    Object.assign(class extends globalThis.URL {}, { createObjectURL, revokeObjectURL }),
  )
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    expect(this.download).toBe("yugilife-dot-mask.png")
  })
  const manualMask = new Blob(["mask"], { type: "image/png" })
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  try {
    act(() => {
      root.render(
        <ArtworkEditor
          artwork={new Blob()}
          canResetTransform={false}
          mask={{ manualMask, mode: "manual", points: [] }}
          maskEffects={undefined}
          pinSize={24}
          selectedPinId={null}
          tool="select"
          transform={{ scale: 1, x: 0, y: 0 }}
          onMaskChange={vi.fn()}
          onMaskEffectsChange={undefined}
          onPinSizeChange={vi.fn()}
          onResetTransform={vi.fn()}
          onSelectedPinChange={vi.fn()}
          onToolChange={vi.fn()}
          onTransformChange={vi.fn()}
        />,
      )
    })
    expect(
      document.querySelector('[role="slider"][aria-label="Zoom"]')?.getAttribute("aria-valuemax"),
    ).toBe("2.5")
    ;[...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Download mask")!
      .click()
    expect(createObjectURL).toHaveBeenCalledExactlyOnceWith(manualMask)
    expect(click).toHaveBeenCalledOnce()
  } finally {
    act(() => root.unmount())
  }
})
