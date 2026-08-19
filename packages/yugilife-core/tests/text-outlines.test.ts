import { describe, expect, it } from "vitest"

import { isTopDominantBaseline } from "../src/rendering/text-outlines.js"

describe("SVG text baseline normalization", () => {
  it("recognizes Chromium and Firefox values for a top-anchored SVG text baseline", () => {
    expect(isTopDominantBaseline("text-before-edge")).toBe(true)
    expect(isTopDominantBaseline("text-top")).toBe(true)
    expect(isTopDominantBaseline("auto")).toBe(false)
  })
})
