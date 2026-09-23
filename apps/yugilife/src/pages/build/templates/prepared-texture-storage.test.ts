import { afterEach, describe, expect, it } from "vitest"

import {
  activationProgressPercent,
  preparedTexturesForBundle,
  preparedTexturesSettled,
} from "./prepare-template-textures"
import {
  deletePreparedTextures,
  preparedTextureSize,
  readPreparedTextures,
  storePreparedTextures,
} from "./prepared-texture-storage"
import { deleteStoredTemplate, storeTemplate } from "./template-storage"

import type { ActivePreparedTextures } from "./prepare-template-textures"
import type { CardTemplateBundle, PreparedTexturePayload } from "yugilife-core"

const templateId = "user/prepared-texture-test"

function payload(key: string): PreparedTexturePayload {
  return {
    key,
    color: new Blob([new Uint8Array(32)], { type: "image/png" }),
    height: 4,
    width: 4,
  }
}

function bundleOf(version: string): CardTemplateBundle {
  return {
    assets: {},
    colorPresets: {},
    manifest: {
      assets: {},
      id: templateId,
      kind: "card",
      name: "Prepared texture test",
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

describe("prepared texture storage", () => {
  afterEach(async () => {
    await deletePreparedTextures(templateId)
  })

  it("returns stored textures only for the exact release that produced them", async () => {
    const payloads = [payload("frame"), payload("effect-box")]
    await storePreparedTextures(templateId, "2026.09.16", payloads).catch(() => undefined)

    expect(await readPreparedTextures(templateId, "2026.09.16")).toHaveLength(2)
    expect(await readPreparedTextures(templateId, "2026.09.17")).toBeUndefined()
  })

  it("reports the bytes it holds so the cache total covers them", () => {
    expect(preparedTextureSize([payload("frame"), payload("effect-box")])).toBe(64)
  })

  it("forgets textures once their template is deleted", async () => {
    await storePreparedTextures(templateId, "2026.09.16", [payload("frame")]).catch(() => undefined)
    await deletePreparedTextures(templateId)

    expect(await readPreparedTextures(templateId, "2026.09.16")).toBeUndefined()
  })

  it("forgets textures when the bundle that produced them is replaced in place", async () => {
    // An edited user template keeps its identity and may keep its version while replacing the very
    // presets those textures were graded with.
    await storePreparedTextures(templateId, "2026.09.16", [payload("frame")]).catch(() => undefined)
    await storeTemplate(bundleOf("2026.09.16"), "user")

    expect(await readPreparedTextures(templateId, "2026.09.16")).toBeUndefined()
    await deleteStoredTemplate(templateId)
  })
})

describe("prepared textures paired with a bundle", () => {
  const bundle = bundleOf("2026.09.16")
  const textures = { get: () => undefined }
  const active: ActivePreparedTextures = { bundle, textures }

  it("hands the renderer only textures graded from the bundle it is drawing", () => {
    expect(preparedTexturesForBundle(active, bundle)).toBe(textures)
    expect(preparedTexturesForBundle(active, undefined)).toBeUndefined()
    expect(preparedTexturesForBundle(undefined, bundle)).toBeUndefined()
  })

  it("rejects an equally named bundle, which an edit can replace without moving its version", () => {
    expect(preparedTexturesForBundle(active, bundleOf("2026.09.16"))).toBeUndefined()
  })

  it("settles a bundle that prepared nothing, so a failure still renders its card", () => {
    const failed: ActivePreparedTextures = { bundle, textures: undefined }

    expect(preparedTexturesSettled(failed, bundle)).toBe(true)
    expect(preparedTexturesForBundle(failed, bundle)).toBeUndefined()
  })

  it("keeps a bundle unsettled until its own preparation finishes", () => {
    expect(preparedTexturesSettled(undefined, bundle)).toBe(false)
    expect(preparedTexturesSettled(active, bundleOf("2026.09.16"))).toBe(false)
  })
})

describe("template activation progress", () => {
  it("reports one percentage across downloading and preparing", () => {
    expect(activationProgressPercent({ loaded: 512, phase: "downloading", total: 2048 })).toBe(25)
    expect(activationProgressPercent({ completed: 12, phase: "preparing", total: 16 })).toBe(75)
  })

  it("stays indeterminate while the total is unknown", () => {
    expect(activationProgressPercent({ loaded: 512, phase: "downloading" })).toBeUndefined()
  })
})
