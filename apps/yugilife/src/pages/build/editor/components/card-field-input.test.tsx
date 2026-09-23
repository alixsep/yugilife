import { act, useState } from "react"

import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { focusPrimaryCardFieldControl } from "../../page/card-field-focus"

import { CardFieldInput } from "./card-field-input"

import type { CardFieldDefinition } from "yugilife-core"

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}

const typesField: CardFieldDefinition = {
  kind: "text-list",
  label: "Types",
  maxItems: 6,
  name: "types",
  required: true,
}

const richTextField: CardFieldDefinition = {
  kind: "multiline",
  label: "Effect",
  maxLength: 8,
  name: "effect",
}

const booleanField: CardFieldDefinition = {
  kind: "boolean",
  label: "Pendulum",
  name: "pendulum",
}

const linkArrowsField: CardFieldDefinition = {
  kind: "text-list",
  label: "Active Link arrows",
  maxItems: 8,
  name: "linkArrows",
  options: [
    "top-left",
    "top-center",
    "top-right",
    "right-center",
    "bottom-right",
    "bottom-center",
    "bottom-left",
    "left-center",
  ],
}

const suggestedField: CardFieldDefinition = {
  kind: "text",
  label: "Edition",
  name: "edition",
  suggestions: [
    { label: "1st Edition", value: "1<sup>st</sup> Edition" },
    { label: "Limited Edition", value: "LIMITED EDITION" },
  ],
}

const stickerField: CardFieldDefinition = {
  defaultValue: "none",
  kind: "text",
  label: "Sticker",
  name: "sticker",
  options: ["none", "sticker-1", "sticker-2"],
}

const passcodeField: CardFieldDefinition = {
  kind: "text",
  label: "Passcode",
  name: "serialNumber",
}

const artworkField: CardFieldDefinition = {
  kind: "image",
  label: "Artwork",
  name: "artwork",
}

const scalesField: CardFieldDefinition = {
  kind: "number-pair",
  label: "Pendulum scales",
  max: 13,
  min: 0,
  name: "scales",
}

afterEach(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe("CardFieldInput", () => {
  it("focuses the requested input of a real number-pair control", () => {
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)

    act(() => {
      root.render(<CardFieldInput field={scalesField} onChange={vi.fn()} value={[1, 8]} />)
    })

    const inputs = container.querySelectorAll<HTMLInputElement>(
      'input:not([aria-hidden="true"]):not([tabindex="-1"])',
    )
    expect(inputs).toHaveLength(2)
    expect(focusPrimaryCardFieldControl(container, 1)).toBe(true)
    expect(document.activeElement).toBe(inputs[1])

    act(() => root.unmount())
  })

  it("keeps passcodes as text so leading zeros survive editing", () => {
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    const onChange = vi.fn()
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)

    act(() => {
      root.render(<CardFieldInput field={passcodeField} onChange={onChange} value="01111111" />)
    })

    const input = container.querySelector("input") as HTMLInputElement
    expect(input.type).toBe("text")
    expect(input.value).toBe("01111111")
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "00123456",
      )
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(onChange).toHaveBeenLastCalledWith("serialNumber", "00123456")

    act(() => root.unmount())
  })

  it("shows hydrated Blob artwork from inventory", () => {
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    const createObjectURL = vi.fn(() => "blob:stored-artwork")
    const revokeObjectURL = vi.fn()
    vi.stubGlobal(
      "URL",
      Object.assign(class extends globalThis.URL {}, { createObjectURL, revokeObjectURL }),
    )
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const artwork = new Blob(["artwork"], { type: "image/png" })

    act(() => {
      root.render(<CardFieldInput field={artworkField} onChange={vi.fn()} value={artwork} />)
    })

    expect(createObjectURL).toHaveBeenCalledWith(artwork)
    expect(container.querySelector('button[aria-label="Download"]')).not.toBeNull()
    expect(container.querySelector('button[aria-label="Remove"]')).not.toBeNull()

    act(() => root.unmount())
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:stored-artwork")
  })

  it("offers canonical text suggestions while keeping the input editable", () => {
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    const onChange = vi.fn()
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)

    act(() => {
      root.render(<CardFieldInput field={suggestedField} onChange={onChange} value="Custom" />)
    })

    const input = container.querySelector("input") as HTMLInputElement
    expect(input.value).toBe("Custom")
    expect(input.getAttribute("role")).toBe("combobox")
    expect(container.querySelector("datalist")).toBeNull()

    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "Another custom value",
      )
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(onChange).toHaveBeenLastCalledWith("edition", "Another custom value")

    act(() => root.unmount())
  })

  it("keeps a suggestion's canonical value after the popup closes", async () => {
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    const onChange = vi.fn()
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)

    function ControlledField() {
      const [value, setValue] = useState("")
      return (
        <CardFieldInput
          field={suggestedField}
          value={value}
          onChange={(name, next) => {
            onChange(name, next)
            setValue(next as string)
          }}
        />
      )
    }

    act(() => root.render(<ControlledField />))
    const input = container.querySelector("input") as HTMLInputElement
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "1st")
      input.dispatchEvent(
        new InputEvent("input", { bubbles: true, data: "1st", inputType: "insertText" }),
      )
    })
    const option = [...document.querySelectorAll<HTMLElement>("[role=option]")].find((element) =>
      element.textContent?.includes("1st Edition"),
    )
    expect(option).toBeDefined()

    act(() => option?.click())
    expect(onChange).toHaveBeenCalledWith("edition", "1<sup>st</sup> Edition")
    expect(onChange).not.toHaveBeenCalledWith("edition", "1st Edition")
    expect(input.value).toBe("1<sup>st</sup> Edition")

    await act(() => new Promise((resolve) => window.setTimeout(resolve, 400)))
    expect(input.value).toBe("1<sup>st</sup> Edition")

    act(() => root.unmount())
  })

  it("edits boolean modifier fields as checked state", () => {
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    const onChange = vi.fn()
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)

    act(() => {
      root.render(<CardFieldInput field={booleanField} onChange={onChange} value={false} />)
    })

    const input = container.querySelector("button[aria-pressed]") as HTMLButtonElement
    expect(container.querySelector("label")?.textContent).toBe("Pendulum")
    expect(input.getAttribute("aria-pressed")).toBe("false")
    expect(input.textContent).toContain("Off")
    act(() => input.click())
    expect(onChange).toHaveBeenLastCalledWith("pendulum", true)

    act(() => root.unmount())
  })

  it("edits Link arrows with a directional selector", () => {
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    const onChange = vi.fn()
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <CardFieldInput field={linkArrowsField} onChange={onChange} value={["bottom-center"]} />,
      )
    })

    expect(
      container.querySelector('button[aria-label="Bottom center"]')?.getAttribute("aria-pressed"),
    ).toBe("true")
    expect(
      container.querySelector('button[aria-label="Top left"]')?.getAttribute("aria-pressed"),
    ).toBe("false")

    const topLeftButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Top left"]',
    )
    expect(topLeftButton).not.toBeNull()
    act(() => topLeftButton?.click())
    expect(onChange).toHaveBeenLastCalledWith("linkArrows", ["top-left", "bottom-center"])

    act(() => root.unmount())
  })

  it("keeps each entry independent and adds or removes fields without slash parsing", async () => {
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    const onChange = vi.fn()
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <CardFieldInput
          field={typesField}
          onChange={onChange}
          value={["Dragon/Effect", "Machine"]}
        />,
      )
    })

    expect([...container.querySelectorAll("input")].map((input) => input.value)).toEqual([
      "Dragon/Effect",
      "Machine",
    ])

    const addButtons = container.querySelectorAll('button[aria-label^="Add Types"]')
    act(() => {
      ;(addButtons[0] as HTMLButtonElement).click()
    })
    expect(onChange).toHaveBeenLastCalledWith("types", ["Dragon/Effect", "", "Machine"])

    act(() => {
      root.render(
        <CardFieldInput
          field={typesField}
          onChange={onChange}
          value={["Dragon/Effect", "", "Machine"]}
        />,
      )
    })
    const removeButtons = container.querySelectorAll('button[aria-label^="Remove Types"]')
    act(() => {
      ;(removeButtons[1] as HTMLButtonElement).click()
    })
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    const confirmButton = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Remove item",
    )
    expect(confirmButton).toBeDefined()
    act(() => confirmButton?.click())
    expect(onChange).toHaveBeenLastCalledWith("types", ["Dragon/Effect", "Machine"])
    expect((removeButtons[0] as HTMLButtonElement).disabled).toBe(false)

    act(() => root.unmount())
  })

  it("accepts formatted source without adding noisy length metadata", () => {
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <CardFieldInput
          field={richTextField}
          onChange={vi.fn()}
          value={'<color value="#ff0000">ABCD</color>'}
        />,
      )
    })

    expect(container.querySelector("textarea")?.maxLength).toBe(-1)
    expect(container.textContent).not.toContain("Visible characters")

    act(() => root.unmount())
  })
  it("does not add a clearing row to a field that declares its own None option", async () => {
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)

    act(() => {
      root.render(<CardFieldInput field={stickerField} onChange={vi.fn()} value="none" />)
    })

    const trigger = container.querySelector("button") as HTMLButtonElement
    trigger.hasPointerCapture = () => false
    trigger.setPointerCapture = () => {}
    trigger.releasePointerCapture = () => {}
    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0, cancelable: true }),
      )
      trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
      await Promise.resolve()
    })

    const labels = Array.from(document.querySelectorAll("[data-proximity-index]")).map((item) =>
      item.textContent?.trim(),
    )
    expect(labels.filter((entry) => entry === "None")).toHaveLength(1)
    expect(labels).toEqual(["None", "Sticker 1", "Sticker 2"])

    act(() => root.unmount())
  })
})
