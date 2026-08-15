import { act } from "react"

import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

import { ImageDropzone } from "./file-upload"
import { NumberInput } from "./number-input"
import { Switch } from "./switch"

import type { ReactNode } from "react"

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}

afterEach(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  document.body.replaceChildren()
})

function render(element: ReactNode) {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  act(() => root.render(element))
  return { container, root }
}

describe("editor control fine-tuning", () => {
  it("keeps both number steppers in the keyboard tab order with flush hover surfaces", () => {
    const { container, root } = render(<NumberInput value={4} min={0} max={12} />)

    const decrease = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Decrease value"]',
    )
    const increase = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Increase value"]',
    )

    expect(decrease?.tabIndex).toBe(0)
    expect(increase?.tabIndex).toBe(0)
    expect(decrease?.firstElementChild).toHaveProperty(
      "className",
      expect.stringContaining("size-full"),
    )
    expect(increase?.firstElementChild).toHaveProperty(
      "className",
      expect.stringContaining("size-full"),
    )

    act(() => root.unmount())
  })

  it("uses the shared blue focus token for switches", () => {
    const { container, root } = render(
      <Switch checked={false} label="Notifications" onToggle={() => {}} />,
    )

    expect(container.querySelector('[role="switch"]')?.className).toContain("--focus-ring")

    act(() => root.unmount())
  })

  it("uses a controlled sparse dash pattern for the image dropzone", () => {
    const { container, root } = render(<ImageDropzone />)

    expect(container.querySelector("rect")?.getAttribute("stroke-dasharray")).toBe("6 7")

    act(() => root.unmount())
  })
})
