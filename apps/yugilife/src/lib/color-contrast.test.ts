import { describe, expect, it } from "vitest"

import { contrastingForeground, foregroundForCssColor, relativeLuminance } from "./color-contrast"

describe("accent color contrast", () => {
  it("calculates WCAG relative luminance", () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0)
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBe(1)
  })

  it("chooses the higher-contrast black or white foreground", () => {
    expect(contrastingForeground({ r: 0, g: 0, b: 0 })).toBe("#ffffff")
    expect(contrastingForeground({ r: 255, g: 255, b: 255 })).toBe("#000000")
    expect(contrastingForeground({ r: 18, g: 52, b: 86 })).toBe("#ffffff")
    expect(contrastingForeground({ r: 101, g: 212, b: 138 })).toBe("#000000")
  })

  it("supports compact and full hex accent values", () => {
    expect(foregroundForCssColor("#fff")).toBe("#000000")
    expect(foregroundForCssColor("#65D48A")).toBe("#000000")
    expect(foregroundForCssColor("#123456ff")).toBe("#ffffff")
  })

  it("composites translucent accents over the active background", () => {
    expect(foregroundForCssColor("#0000", "#ffffff")).toBe("#000000")
    expect(foregroundForCssColor("#fff0", "#000000")).toBe("#ffffff")
    expect(foregroundForCssColor("#ffffff80", "#000000")).toBe("#000000")
  })
})
