import { describe, expect, it } from "vitest"

import { normalizeDeviceTilt } from "./device-tilt"

describe("device tilt normalization", () => {
  const origin = { beta: 10, gamma: 5 }

  it("normalizes portrait movement around the first sensor reading", () => {
    expect(normalizeDeviceTilt(22, 17, origin, 0)).toEqual({ x: 0.5, y: 0.5 })
  })

  it("maps physical movement through landscape screen rotation", () => {
    expect(normalizeDeviceTilt(22, 17, origin, 90)).toEqual({ x: 0.5, y: -0.5 })
    expect(normalizeDeviceTilt(22, 17, origin, 270)).toEqual({ x: -0.5, y: 0.5 })
  })

  it("clamps extreme sensor movement", () => {
    expect(normalizeDeviceTilt(100, -100, origin, 0)).toEqual({ x: -1, y: 1 })
  })
})
