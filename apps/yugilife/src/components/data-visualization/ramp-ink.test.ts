import { describe, expect, it } from "vitest"

import { foregroundForCssColor, relativeLuminance } from "@/lib/color-contrast"

import { chartRampPosition } from "./chart-tokens"

/**
 * The resolved values of `--chart-ramp-1..4` for the default accent, in both modes.
 *
 * `useRampInks` measures these at runtime because the accent is the reader's choice. These fixed
 * samples lock in the contract it relies on: that picking the ink per step, rather than reusing the
 * accent's page foreground everywhere, is what keeps a label on the darker end of the ramp legible.
 */
const LIGHT_RAMP = ["#5ebf7d", "#4a895e", "#365840", "#243128"] as const
const DARK_RAMP = ["#65d48a", "#55a66f", "#467e57", "#3b6346"] as const

function rgb(hex: string) {
  return {
    b: Number.parseInt(hex.slice(5, 7), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    r: Number.parseInt(hex.slice(1, 3), 16),
  }
}

function contrast(a: string, b: string) {
  const [high, low] = [relativeLuminance(rgb(a)), relativeLuminance(rgb(b))].sort((x, y) => y - x)
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05)
}

describe("ramp ink", () => {
  it("keeps every step's label readable in light mode", () => {
    for (const step of LIGHT_RAMP) {
      const ink = foregroundForCssColor(step, "#fafafa")
      expect(contrast(ink, step)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("keeps every step's label readable in dark mode", () => {
    for (const step of DARK_RAMP) {
      const ink = foregroundForCssColor(step, "#171717")
      expect(contrast(ink, step)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("does not pick one ink for the whole ramp", () => {
    // The lightest step wants dark ink and the darkest wants light ink. A single choice — which is
    // what `--user-accent-foreground` alone would give — is wrong at one end or the other.
    const inks = LIGHT_RAMP.map((step) => foregroundForCssColor(step, "#fafafa"))
    expect(new Set(inks).size).toBeGreaterThan(1)
  })

  it("would leave the darkest step illegible if the lightest step's ink were reused", () => {
    const lightestInk = foregroundForCssColor(LIGHT_RAMP[0], "#fafafa")
    expect(contrast(lightestInk, LIGHT_RAMP[3])).toBeLessThan(4.5)
  })
})

describe("chartRampPosition", () => {
  it("spreads any number of parts across the four steps", () => {
    expect(chartRampPosition(0, 1)).toBe(0)
    expect([0, 1, 2, 3].map((index) => chartRampPosition(index, 4))).toEqual([0, 1, 2, 3])
    expect([0, 1, 2].map((index) => chartRampPosition(index, 3))).toEqual([0, 2, 3])
  })

  it("never runs off the end of the ramp", () => {
    for (let index = 0; index < 12; index += 1) {
      expect(chartRampPosition(index, 12)).toBeLessThanOrEqual(3)
      expect(chartRampPosition(index, 12)).toBeGreaterThanOrEqual(0)
    }
  })
})
