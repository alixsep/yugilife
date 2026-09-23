import { act } from "react"

import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CardArtworkChooser } from "./card-artwork-chooser"

import type { CardCatalogEntry } from "../model/card-catalog"

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}

afterEach(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe("CardArtworkChooser", () => {
  it("shows Blob previews and exposes each variant as an accessible radio choice", () => {
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce("blob:primary")
      .mockReturnValueOnce("blob:alternate")
    const revokeObjectURL = vi.fn()
    vi.stubGlobal(
      "URL",
      Object.assign(class extends globalThis.URL {}, { createObjectURL, revokeObjectURL }),
    )
    const primary = new Blob(["primary"], { type: "image/avif" })
    const alternate = new Blob(["alternate"], { type: "image/avif" })
    const entry = {
      artworkIds: [4766, 23488],
      description: "",
      frame: "effect",
      konamiCid: 4766,
      name: "Dark Magician Girl",
      passcode: "38033121",
      sourceId: 38033121,
    } satisfies CardCatalogEntry
    const onSelect = vi.fn()
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <CardArtworkChooser
          artworkSet={{
            artworks: new Map([
              [4766, { image: primary }],
              [23488, { image: alternate }],
            ]),
            entry,
            selectedArtworkId: 4766,
          }}
          onSelect={onSelect}
        />,
      )
    })

    const previews = [...container.querySelectorAll("img")]
    const choices = [...container.querySelectorAll<HTMLElement>("[role=radio]")]
    expect(previews.map(({ src }) => src)).toEqual(["blob:primary", "blob:alternate"])
    expect(previews.every((preview) => preview.classList.contains("rounded-lg"))).toBe(true)
    expect(choices.map((choice) => choice.getAttribute("aria-label"))).toEqual([
      "Dark Magician Girl artwork 1",
      "Dark Magician Girl artwork 2",
    ])

    act(() => choices[1]?.click())
    expect(onSelect).toHaveBeenCalledWith(23488)

    act(() => root.unmount())
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:primary")
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:alternate")
  })
})
