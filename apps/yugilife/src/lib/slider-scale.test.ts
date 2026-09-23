import { describe, expect, it } from "vitest"

import { linearSliderScale, powerSliderScale } from "./slider-scale"

describe("power slider scale", () => {
  const scale = powerSliderScale(32, 0.5)

  it("allocates half the track to the lower value range with a smooth curve", () => {
    expect(scale.valueToPosition(0, 0, 128)).toBe(0)
    expect(scale.valueToPosition(32, 0, 128)).toBe(0.5)
    expect(scale.valueToPosition(128, 0, 128)).toBe(1)
    expect(scale.positionToValue(0.5, 0, 128)).toBe(32)
    expect(scale.valueToPosition(32, 4, 128)).toBe(0.5)
    expect(scale.positionToValue(0.5, 4, 128)).toBeCloseTo(32)
    expect(scale.valueToPosition(16, 0, 128)).toBeCloseTo(Math.sqrt(0.125))
    expect(scale.valueToPosition(16, 0, 128)).toBeGreaterThan(16 / 128)
  })

  it("round trips values across the full range", () => {
    for (const value of [0, 8, 16, 31, 32, 48, 96, 128]) {
      const position = scale.valueToPosition(value, 0, 128)
      expect(scale.positionToValue(position, 0, 128)).toBeCloseTo(value)
    }
  })

  it("falls back to a linear scale when the midpoint is outside the range", () => {
    expect(powerSliderScale(256).valueToPosition(32, 0, 128)).toBe(
      linearSliderScale.valueToPosition(32, 0, 128),
    )
  })

  it("keeps the endpoints valid for an unusable midpoint position", () => {
    const scaleWithInvalidPosition = powerSliderScale(32, 0)
    expect(scaleWithInvalidPosition.valueToPosition(0, 0, 128)).toBe(0)
    expect(scaleWithInvalidPosition.positionToValue(0, 0, 128)).toBe(0)
  })
})
