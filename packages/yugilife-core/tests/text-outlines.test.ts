import { describe, expect, it } from "vitest"

import { declaredTextLengthScale, isTopDominantBaseline } from "../src/rendering/text-outlines.js"

describe("SVG text baseline normalization", () => {
  it("recognizes Chromium and Firefox values for a top-anchored SVG text baseline", () => {
    expect(isTopDominantBaseline("text-before-edge")).toBe(true)
    expect(isTopDominantBaseline("text-top")).toBe(true)
    expect(isTopDominantBaseline("auto")).toBe(false)
  })

  it("derives a manual glyph scale from a textLength run when browser metrics ignore it", () => {
    expect(declaredTextLengthScale("spacingAndGlyphs", "11.62", 14)).toBeCloseTo(0.83)
    expect(declaredTextLengthScale("spacing", "11.62", 14)).toBeUndefined()
    expect(declaredTextLengthScale("spacingAndGlyphs", null, 14)).toBeUndefined()
  })
})
