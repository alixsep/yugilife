import { describe, expect, it } from "vitest"

import { templateManagerActionLabel } from "./template-manager-actions"

describe("template manager version actions", () => {
  it("offers an explicit update when the cached version is stale", () => {
    expect(
      templateManagerActionLabel({
        hasError: false,
        loaded: false,
        loading: false,
        selectedTemplateVersion: "2026.08.12.1",
        storedTemplate: { version: "2026.08.12" },
      }),
    ).toBe("Update assets")
  })
})
