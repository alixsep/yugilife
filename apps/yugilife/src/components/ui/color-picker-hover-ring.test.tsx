import { act } from "react"

import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ColorPicker } from "./color-picker"

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}

const roots: Array<ReturnType<typeof createRoot>> = []

beforeEach(() => {
  // The panel measures itself; jsdom ships no ResizeObserver.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect() {}
      observe() {}
      unobserve() {}
    },
  )
})

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()))
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

function renderPicker() {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => root.render(<ColorPicker defaultValue="#6B97FF" />))
  return container
}

describe("saturation square hover ring", () => {
  it("stays mounted while hidden", () => {
    const container = renderPicker()
    const square = container.querySelector('[aria-label="Saturation and brightness"]')
    const ring = square?.querySelector<HTMLElement>('[aria-hidden="true"].rounded-full')

    // Its position is written imperatively on pointer move, so unmounting it between hovers would
    // restore the `0%` in its style attribute and drop it in the square's top-left corner.
    expect(ring).not.toBeNull()
    expect(ring?.style.opacity).toBe("0")
    expect(ring?.style.left).toBe("0%")
  })
})
