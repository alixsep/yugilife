import { describe, expect, it } from "vitest"

import {
  areaPath,
  barPath,
  compactNumber,
  formatNumber,
  linearScale,
  linePath,
  nearestIndex,
  niceNumber,
  niceTicks,
} from "./chart-scales"

describe("linearScale", () => {
  it("maps the domain onto the range and back", () => {
    const scale = linearScale([0, 100], [10, 210])
    expect(scale(0)).toBe(10)
    expect(scale(50)).toBe(110)
    expect(scale(100)).toBe(210)
    expect(scale.invert(110)).toBe(50)
  })

  it("supports an inverted range, which is how a y-axis is drawn", () => {
    const scale = linearScale([0, 10], [200, 0])
    expect(scale(0)).toBe(200)
    expect(scale(10)).toBe(0)
  })

  it("pins a zero-width domain to the middle instead of dividing by zero", () => {
    const scale = linearScale([5, 5], [0, 100])
    expect(scale(5)).toBe(50)
    expect(Number.isFinite(scale(9))).toBe(true)
  })
})

describe("niceNumber", () => {
  it("rounds up to the 1/2/2.5/5/10 family", () => {
    expect(niceNumber(0.021, false)).toBeCloseTo(0.025, 6)
    expect(niceNumber(7300, false)).toBe(10000)
    expect(niceNumber(0, false)).toBe(0)
  })
})

describe("niceTicks", () => {
  it("produces round bounds that contain the data", () => {
    const { domain, ticks } = niceTicks(0, 8032.9, 4, { zeroBased: true })
    expect(domain[0]).toBe(0)
    expect(domain[1]).toBeGreaterThanOrEqual(8032.9)
    expect(ticks[0]).toBe(0)
    expect(ticks.at(-1)).toBe(domain[1])
  })

  it("keeps ticks free of floating-point drift", () => {
    const { ticks } = niceTicks(0, 1, 5, { zeroBased: true })
    for (const tick of ticks) {
      expect(String(tick)).not.toMatch(/0{6}\d|9{6}\d/)
    }
  })

  it("does not force a zero baseline unless asked", () => {
    const { domain } = niceTicks(60, 100, 4)
    expect(domain[0]).toBeGreaterThan(0)
  })

  it("pads a domain with no width so the axis still has extent", () => {
    const { domain } = niceTicks(7, 7, 4)
    expect(domain[1]).toBeGreaterThan(domain[0])
  })

  it("falls back to a unit domain for non-finite input", () => {
    expect(niceTicks(Number.NaN, 10).domain).toEqual([0, 1])
  })
})

describe("paths", () => {
  it("builds a polyline through the points", () => {
    expect(
      linePath([
        [0, 0],
        [10, 5],
      ]),
    ).toBe("M0 0L10 5")
    expect(linePath([])).toBe("")
  })

  it("closes an area down to the baseline", () => {
    expect(
      areaPath(
        [
          [0, 0],
          [10, 5],
        ],
        20,
      ),
    ).toBe("M0 0L10 5L10 20L0 20Z")
    expect(areaPath([], 20)).toBe("")
  })

  it("rounds only the data-end of a bar", () => {
    const path = barPath(0, 0, 100, 16, 4, "right")
    // One arc per rounded corner: the two at the data-end, and none at the baseline.
    expect(path.match(/a/g)).toHaveLength(2)
    expect(path.startsWith("M0 0")).toBe(true)
  })

  it("never rounds more than the mark can carry", () => {
    // A 2px-wide bar with a 4px radius would otherwise produce inverted corners.
    expect(() => barPath(0, 0, 2, 16, 4, "right")).not.toThrow()
    expect(barPath(0, 0, 0, 16, 4, "right")).toContain("M0 0")
  })
})

describe("nearestIndex", () => {
  it("finds the closest position", () => {
    expect(nearestIndex([0, 10, 20, 30], 22)).toBe(2)
    expect(nearestIndex([0, 10], -5)).toBe(0)
    expect(nearestIndex([], 5)).toBe(-1)
  })
})

describe("formatting", () => {
  it("compacts only above the thousands threshold", () => {
    expect(compactNumber(484)).toBe("484")
    expect(compactNumber(5_529)).toBe("5,529")
    expect(compactNumber(12_900)).toBe("12.9K")
    expect(compactNumber(4_200_000)).toBe("4.2M")
  })

  it("separates thousands and trims trailing decimals", () => {
    expect(formatNumber(7606.7, 1)).toBe("7,606.7")
    expect(formatNumber(63.5)).toBe("63.5")
  })
})
