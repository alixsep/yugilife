import { expect, it } from "vitest"

import { resampleAlpha } from "./resample-alpha"

it("uses the same pixel-center coverage for alpha planes and RGBA previews", () => {
  const alpha = Uint8Array.of(0, 255)
  const rgba = Uint8ClampedArray.of(255, 255, 255, 0, 255, 255, 255, 255)
  expect([...resampleAlpha(alpha, 2, 1, 1, 1)]).toEqual([128])
  expect(resampleAlpha(rgba, 2, 1, 7, 3, 4, 3)).toEqual(resampleAlpha(alpha, 2, 1, 7, 3))
  expect([...alpha]).toEqual([0, 255])
})
