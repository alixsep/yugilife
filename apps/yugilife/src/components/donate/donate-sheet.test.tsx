import { act } from "react"

import * as DialogPrimitive from "@radix-ui/react-dialog"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { donateContacts, donateCopy } from "./donate-contacts"
import { DonateSheet } from "./donate-sheet"

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}

afterEach(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  document.body.replaceChildren()
  vi.useRealTimers()
})

function renderSheet() {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  act(() =>
    root.render(
      <DialogPrimitive.Root open>
        <DonateSheet />
      </DialogPrimitive.Root>,
    ),
  )
  const button = (label: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  const named = (text: string) =>
    [...container.querySelectorAll("button")].find((element) => element.textContent === text)
  return { button, container, named, root }
}

describe("DonateSheet", () => {
  it("opens every contact as a link and names the ask", () => {
    const { button, container, root } = renderSheet()
    expect(container.textContent).toContain(donateCopy.title)
    // Only the contacts that have somewhere to go are links: Discord has no profile URL for a
    // username, so its row is text you copy rather than an anchor that would 404.
    const links = [...container.querySelectorAll<HTMLAnchorElement>("a[href]")]
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      donateContacts.filter((contact) => contact.href).map((contact) => contact.href),
    )
    // Every contact gets a row naming the platform, with its handle beside the copy control.
    const rows = [...container.querySelectorAll("li")]
    expect(rows).toHaveLength(donateContacts.length)
    for (const [index, contact] of donateContacts.entries()) {
      expect(rows[index]!.textContent).toContain(contact.label)
      expect(rows[index]!.textContent).toContain(contact.handle)
    }
    // The way out is an icon in the corner, named for anyone who cannot see it is an X.
    expect(button("Close")).not.toBeNull()
    act(() => root.unmount())
  })

  it("copies a handle to the clipboard and says so briefly", async () => {
    vi.useFakeTimers()
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    const { button, root } = renderSheet()
    const [first] = donateContacts

    await act(async () => {
      button(`Copy ${first!.label}`)!.click()
      await Promise.resolve()
    })
    expect(writeText).toHaveBeenCalledWith(first!.handle)
    expect(button(`Copied ${first!.label}`)).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(button(`Copy ${first!.label}`)).not.toBeNull()
    act(() => root.unmount())
  })

  it("keeps the codes folded away behind a toggle, one named per contact", () => {
    const { container, named, root } = renderSheet()
    const codes = () => [...container.querySelectorAll('svg[role="img"]')]
    const toggle = () => (named("Show QR codes") ?? named("Hide QR codes"))!
    // Folded, not unmounted, so the reveal has a height to animate between; hidden means inert.
    const region = () => container.querySelector(`#${toggle().getAttribute("aria-controls")}`)!

    // The handle is readable as text either way, for anyone typing it in rather than scanning.
    donateContacts.forEach((contact) => expect(container.textContent).toContain(contact.handle))
    expect(toggle().getAttribute("aria-expanded")).toBe("false")
    expect(region().getAttribute("aria-hidden")).toBe("true")
    expect(region().hasAttribute("inert")).toBe(true)

    act(() => toggle().click())
    expect(toggle().getAttribute("aria-expanded")).toBe("true")
    expect(region().hasAttribute("inert")).toBe(false)
    expect(codes()).toHaveLength(donateContacts.length)
    donateContacts.forEach((contact, index) => {
      // Each code says which platform it is, to a reader and to a caption under it, and carries
      // the link where there is one and the handle itself where there is not.
      expect(codes()[index]!.getAttribute("aria-label")).toContain(contact.href ?? contact.handle)
      expect(codes()[index]!.closest("figure")?.textContent).toContain(contact.label)
    })
    // One version for all three, so they read as a set rather than three textures.
    expect(new Set(codes().map((code) => code.getAttribute("viewBox"))).size).toBe(1)

    act(() => toggle().click())
    expect(toggle().getAttribute("aria-expanded")).toBe("false")
    expect(region().hasAttribute("inert")).toBe(true)
    act(() => root.unmount())
  })

  it("emphasises the reason, then each kind of help, inside one sentence", () => {
    const { container, root } = renderSheet()
    const marked = [...container.querySelectorAll("strong")].map((mark) => mark.textContent)

    // One paragraph, not a banner and a paragraph: the reason leads it and the three kinds of
    // help are findable in it without reading the whole thing.
    expect(marked).toEqual([donateCopy.situation, "money", "relocation", "work"])
    // One paragraph, not a banner and a paragraph: the reason leads the same sentence that asks.
    const [reason, firstKind] = [...container.querySelectorAll("strong")]
    expect(reason!.closest("p")).toBe(firstKind!.closest("p"))
    act(() => root.unmount())
  })
})
