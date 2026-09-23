import { describe, expect, it } from "vitest"

import { canPresentArtworkMaskFrame, isArtworkMaskFrameCurrent } from "./artwork-mask-frame"

import type { ArtworkMaskFrameIdentity } from "./artwork-mask-frame"

const completed: ArtworkMaskFrameIdentity = {
  artwork: new Blob(["artwork"]),
  source: new Blob(["old pins"]),
  channel: "luminance",
  mode: "manual",
  effectsKey: "1:16",
}

describe("completed mask presentation", () => {
  it("keeps the completed glow visible while replacement pins are still being processed", () => {
    const next = { ...completed, source: new Blob(["new pins"]) }
    expect(canPresentArtworkMaskFrame(completed, next)).toBe(true)
    expect(isArtworkMaskFrameCurrent(completed, next)).toBe(false)
    expect(isArtworkMaskFrameCurrent(next, next)).toBe(true)
  })
  it("requires the complete requested effects before considering a frame current", () => {
    const next = { ...completed, effectsKey: "1:32" }
    expect(canPresentArtworkMaskFrame(completed, next)).toBe(true)
    expect(isArtworkMaskFrameCurrent(completed, next)).toBe(false)
  })
  it("does not reuse another artwork, mask mode, or channel", () => {
    expect(canPresentArtworkMaskFrame(completed, { ...completed, artwork: new Blob() })).toBe(false)
    expect(canPresentArtworkMaskFrame(completed, { ...completed, mode: "automatic" })).toBe(false)
    expect(canPresentArtworkMaskFrame(completed, { ...completed, channel: "alpha" })).toBe(false)
  })
  it("disables processed presentation entirely when no effects request exists", () => {
    expect(canPresentArtworkMaskFrame(completed, undefined)).toBe(false)
    expect(isArtworkMaskFrameCurrent(completed, undefined)).toBe(false)
  })
})
