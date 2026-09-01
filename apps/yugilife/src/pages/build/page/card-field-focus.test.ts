import { afterEach, describe, expect, it, vi } from "vitest"

import { focusPrimaryCardFieldControl } from "./card-field-focus"

afterEach(() => {
  document.body.replaceChildren()
})

describe("card field focus", () => {
  it("focuses a select combobox trigger and supplies a visible-ring fallback", () => {
    const container = document.createElement("div")
    container.innerHTML = '<button role="combobox">Edition</button>'
    document.body.append(container)
    const trigger = container.querySelector("button")!
    vi.spyOn(trigger, "matches").mockReturnValue(false)

    expect(focusPrimaryCardFieldControl(container)).toBe(true)
    expect(document.activeElement).toBe(trigger)
    expect(trigger.hasAttribute("data-yugilife-forced-focus")).toBe(true)

    trigger.blur()
    expect(trigger.hasAttribute("data-yugilife-forced-focus")).toBe(false)
  })

  it("prefers the editable input over an earlier number stepper button", () => {
    const container = document.createElement("div")
    container.innerHTML = '<button>Decrease</button><input type="text"><button>Increase</button>'
    document.body.append(container)

    expect(focusPrimaryCardFieldControl(container)).toBe(true)
    expect(document.activeElement).toBe(container.querySelector("input"))
  })

  it("focuses the requested member of a paired input", () => {
    const container = document.createElement("div")
    container.innerHTML = '<input aria-label="Left"><input aria-label="Right">'
    document.body.append(container)

    expect(focusPrimaryCardFieldControl(container, 1)).toBe(true)
    expect(document.activeElement).toBe(container.querySelector('[aria-label="Right"]'))
  })
})
