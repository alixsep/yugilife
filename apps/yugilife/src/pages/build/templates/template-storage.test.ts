import { afterEach, describe, expect, it } from "vitest"

import {
  deleteStoredTemplate,
  listStoredTemplates,
  readStoredTemplate,
  storeTemplate,
  templateBundleMatchesVersion,
} from "./template-storage"

import type { CardTemplateBundle } from "yugilife-core"

function bundle(version: string): CardTemplateBundle {
  return {
    assets: {},
    colorPresets: {},
    manifest: {
      assets: {},
      id: "user/template-cache-test",
      kind: "card",
      name: "Template cache test",
      template: "./template.json",
      version,
    },
    template: {
      cardFields: [],
      dimensions: { height: 1, width: 1 },
      layers: [],
      schemaVersion: 1,
    },
  }
}

describe("template storage version identity", () => {
  afterEach(async () => {
    await deleteStoredTemplate("user/template-cache-test")
  })

  it("keeps one record per template ID and replaces it only when stored explicitly", async () => {
    const first = bundle("2026.08.12")
    const second = bundle("2026.08.12.1")

    await storeTemplate(first, "user")
    expect((await readStoredTemplate(first.manifest.id))?.version).toBe("2026.08.12")

    await storeTemplate(second, "user")
    const stored = await listStoredTemplates()
    expect(stored.filter(({ id }) => id === first.manifest.id)).toHaveLength(1)
    expect((await readStoredTemplate(first.manifest.id))?.version).toBe("2026.08.12.1")
  })

  it("matches bundles by both stable ID and exact version", () => {
    const current = bundle("2026.08.12.1")

    expect(templateBundleMatchesVersion(current, current.manifest.id, "2026.08.12.1")).toBe(true)
    expect(templateBundleMatchesVersion(current, current.manifest.id, "2026.08.12")).toBe(false)
    expect(templateBundleMatchesVersion(current, "user/another-template", "2026.08.12.1")).toBe(
      false,
    )
  })
})
