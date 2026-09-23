import { act } from "react"

import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

import { Progress } from "./progress"

import type { ReactNode } from "react"

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}

afterEach(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  document.body.replaceChildren()
})

function renderProgress(element: ReactNode) {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  act(() => root.render(element))
  return { container, root }
}

describe("Progress", () => {
  it("exposes and renders normalized determinate progress", () => {
    const { container, root } = renderProgress(
      <Progress label="Downloading artwork" max={200} value={250} />,
    )
    const progress = container.querySelector<HTMLElement>('[role="progressbar"]')

    expect(progress?.getAttribute("aria-label")).toBe("Downloading artwork")
    expect(progress?.getAttribute("aria-valuemin")).toBe("0")
    expect(progress?.getAttribute("aria-valuemax")).toBe("200")
    expect(progress?.getAttribute("aria-valuenow")).toBe("200")
    expect((progress?.firstElementChild as HTMLElement | undefined)?.style.width).toBe("100%")

    act(() => root.unmount())
  })

  it("uses indeterminate semantics when no value is known", () => {
    const { container, root } = renderProgress(<Progress label="Preparing template" />)
    const progress = container.querySelector<HTMLElement>('[role="progressbar"]')

    expect(progress?.hasAttribute("aria-valuemin")).toBe(false)
    expect(progress?.hasAttribute("aria-valuemax")).toBe(false)
    expect(progress?.hasAttribute("aria-valuenow")).toBe(false)
    expect(progress?.firstElementChild?.classList.contains("animate-pulse")).toBe(true)

    act(() => root.unmount())
  })
})
