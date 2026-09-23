import { act } from "react"

import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Button } from "./button"
import { ConfirmDialog } from "./confirm-dialog"
import { Tooltip } from "./tooltip"

import type { ReactNode } from "react"

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}

const roots: Array<ReturnType<typeof createRoot>> = []

afterEach(() => {
  // Tooltips and dialogs hold deferred-unmount timers. Unmounting runs their cleanup, so nothing
  // fires against a torn-down jsdom window after the file finishes.
  act(() => roots.splice(0).forEach((root) => root.unmount()))
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  document.body.replaceChildren()
})

function render(element: ReactNode) {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => root.render(element))
  return container
}

describe("Tooltip inside an asChild parent", () => {
  it("forwards a parent's click to the button it wraps", () => {
    const onClick = vi.fn()
    const container = render(
      <Tooltip content="Explain" onClick={onClick}>
        <Button aria-label="Act">Act</Button>
      </Tooltip>,
    )

    const button = container.querySelector("button")
    act(() => button?.click())

    // A Tooltip that swallowed its parent's props would leave the control inert.
    expect(onClick).toHaveBeenCalledOnce()
  })

  it("keeps the child's own handler when the parent also supplies one", () => {
    const parentClick = vi.fn()
    const childClick = vi.fn()
    const container = render(
      <Tooltip content="Explain" onClick={parentClick}>
        <Button aria-label="Act" onClick={childClick}>
          Act
        </Button>
      </Tooltip>,
    )

    act(() => container.querySelector("button")?.click())

    expect(parentClick).toHaveBeenCalledOnce()
    expect(childClick).toHaveBeenCalledOnce()
  })

  it("opens a ConfirmDialog whose trigger is wrapped in a Tooltip", async () => {
    render(
      <ConfirmDialog
        confirmLabel="Do it"
        description="This happens."
        onConfirm={vi.fn()}
        title="Are you sure?"
        trigger={
          <Tooltip content="Do it">
            <Button aria-label="Do it">Do it</Button>
          </Tooltip>
        }
      />,
    )

    const trigger = document.querySelector<HTMLButtonElement>('[aria-label="Do it"]')
    await act(async () => {
      trigger?.click()
      // The dialog portal mounts on a frame, so the assertion waits for it rather than racing it.
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(trigger?.getAttribute("data-state")).toBe("open")
    expect(document.body.textContent).toContain("Are you sure?")
  })
})
