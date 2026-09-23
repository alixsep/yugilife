import { describe, expect, it } from "vitest"

import { decodePinMaskPreset } from "./quick-selection"

describe("pin mask preset", () => {
  it("decodes the checked-in pipeline's PMB2 coordinate and diameter contract", () => {
    const source = Uint8Array.from([
      ...new TextEncoder().encode("PMB2"),
      8,
      8,
      40,
      8,
      0,
      0,
      0,
      0x44,
    ])

    expect(decodePinMaskPreset(source)).toEqual([{ id: 1, polarity: "keep", size: 24, x: 2, y: 3 }])
  })

  it("rejects hostile dimensions and truncated coordinate streams", () => {
    expect(() =>
      decodePinMaskPreset(
        Uint8Array.from([...new TextEncoder().encode("PMB2"), 0, 8, 40, 0, 0, 0, 0]),
      ),
    ).toThrow("dimensions")
    expect(() =>
      decodePinMaskPreset(
        Uint8Array.from([...new TextEncoder().encode("PMB2"), 8, 8, 40, 9, 0, 0, 0, 0]),
      ),
    ).toThrow("truncated")
  })
})
