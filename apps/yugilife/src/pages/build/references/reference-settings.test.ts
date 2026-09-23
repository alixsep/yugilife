import { afterEach, expect, it } from "vitest"

import { readComparisonMode, writeComparisonMode } from "./reference-settings"

afterEach(() => localStorage.clear())

it("persists an off comparison mode", () => {
  expect(writeComparisonMode("off")).toBeUndefined()
  expect(readComparisonMode()).toBe("off")
})
