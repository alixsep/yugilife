import { describe, expect, it } from "vitest"

import {
  createInitialCard,
  editorDefaultLayerVisibility,
  editorPresetTargets,
  editorTemplateId,
  editorTemplateVersion,
} from "../editor/model/editor-config"

import { currentEditorDocumentVersion, migrateEditorDocumentSchema } from "./document"
import { isTemplateVersion, migrateEditorTemplateVersion } from "./template"

import type { EditorDocumentState } from "../editor/model/editor-document"

const documentMigrationContext = {
  defaultLayerVisibility: editorDefaultLayerVisibility,
  defaultPresets: Object.fromEntries(
    editorPresetTargets.map(({ defaultPreset, target }) => [target, defaultPreset]),
  ),
}

function currentDocument(): EditorDocumentState {
  return {
    artworkMask: { mode: "automatic", points: [] },
    artworkMaskEffects: {},
    card: createInitialCard(),
    layers: {},
    mode: "automatic",
    presetOverrides: {},
    presentationOverrides: {},
    templateId: editorTemplateId,
    templateVersion: editorTemplateVersion,
  }
}

describe("editor migration pipelines", () => {
  it("upgrades document structure without reinterpreting its template version", () => {
    const migrated = migrateEditorDocumentSchema(
      {
        card: { name: "Legacy" },
        layers: { border: editorDefaultLayerVisibility.border },
        templateId: editorTemplateId,
        templateVersion: 52,
      },
      1,
      documentMigrationContext,
    )

    expect(migrated.layers).toEqual({})
    expect(migrated.templateVersion).toBe(52)
    expect(currentEditorDocumentVersion).toBe(22)
    expect(migrated.artworkMask).toEqual({ mode: "automatic", points: [] })
  })

  it("rejects malformed and future document schema versions", () => {
    expect(() =>
      migrateEditorDocumentSchema({}, currentEditorDocumentVersion + 1, documentMigrationContext),
    ).toThrow(/newer than supported/)
    expect(() => migrateEditorDocumentSchema([], 1, documentMigrationContext)).toThrow(
      /must be an object/,
    )
  })

  it("moves legacy mask effects out of core presentation overrides", () => {
    const migrated = migrateEditorDocumentSchema(
      {
        presentationOverrides: {
          artworkMaskEffects: { artworkOverlay: { antiAlias: true, glow: 6 } },
          artworkTransforms: { artwork: { scale: 1.2, x: 0, y: 0 } },
        },
      },
      19,
      documentMigrationContext,
    )

    expect(migrated.artworkMaskEffects).toEqual({
      artworkOverlay: { antiAlias: true, glow: 6 },
    })
    expect(migrated.presentationOverrides).toEqual({
      artworkTransforms: { artwork: { scale: 1.2, x: 0, y: 0 } },
    })
  })

  it("migrates the legacy full-art boolean to an opaque transform mode", () => {
    const migrated = migrateEditorDocumentSchema(
      {
        presentationOverrides: {
          artworkTransforms: {
            artwork: { fullArt: true, scale: 1.5, x: 0, y: 0 },
            secondary: { fullArt: false, scale: 1.2, x: 0, y: 0 },
          },
        },
      },
      21,
      documentMigrationContext,
    )

    expect(migrated.presentationOverrides?.artworkTransforms).toEqual({
      artwork: { mode: "full-art", scale: 1.5, x: 0, y: 0 },
      secondary: { scale: 1.2, x: 0, y: 0 },
    })
  })

  it("migrates older releases of the same template and rejects future or different identities", () => {
    const saved = {
      card: { name: "Saved card" },
      templateId: editorTemplateId,
      templateVersion: editorTemplateVersion,
    }

    expect(migrateEditorTemplateVersion(saved, currentDocument())).toEqual(saved)
    expect(
      migrateEditorTemplateVersion({ ...saved, templateVersion: "2026.08.30" }, currentDocument()),
    ).toEqual(saved)
    expect(
      migrateEditorTemplateVersion({ ...saved, templateVersion: 52 }, currentDocument()),
    ).toBeUndefined()
    expect(
      migrateEditorTemplateVersion({ ...saved, templateId: "card/other" }, currentDocument()),
    ).toBeUndefined()
    expect(
      migrateEditorTemplateVersion({ ...saved, templateVersion: "2099.01.01" }, currentDocument()),
    ).toBeUndefined()
  })

  it("removes only obsolete Series 10 Link-arrow mask overrides", () => {
    const saved = {
      card: { name: "Saved Link card" },
      presentationOverrides: {
        layerMasks: {
          artworkOverlay: "full-art-coverage",
          linkArrowLayers: "link-arrows",
        },
      },
      templateId: editorTemplateId,
      templateVersion: "2026.08.30",
    }

    expect(migrateEditorTemplateVersion(saved, currentDocument())).toMatchObject({
      card: saved.card,
      presentationOverrides: {
        layerMasks: { artworkOverlay: "full-art-coverage" },
      },
      templateId: editorTemplateId,
      templateVersion: editorTemplateVersion,
    })
  })

  it("removes retired Series 10 Pendulum border state before current validation", () => {
    const saved = {
      card: { name: "Saved Pendulum card" },
      layers: {
        pendulumBorder: true,
        border: false,
      },
      presentationOverrides: {
        layerMasks: {
          artworkOverlay: "full-art-coverage",
          pendulumBorder: "pendulum-texture-opacity",
        },
      },
      templateId: editorTemplateId,
      templateVersion: "2026.09.11",
    }

    expect(migrateEditorTemplateVersion(saved, currentDocument())).toMatchObject({
      card: saved.card,
      layers: { border: false },
      presentationOverrides: {
        layerMasks: { artworkOverlay: "full-art-coverage" },
      },
      templateId: editorTemplateId,
      templateVersion: editorTemplateVersion,
    })
  })

  it("validates real dates and optional same-day release sequences", () => {
    expect(isTemplateVersion("2026.08.12")).toBe(true)
    expect(isTemplateVersion("2026.08.12.1")).toBe(true)
    expect(isTemplateVersion("2026.08.12.10")).toBe(true)
    expect(isTemplateVersion("2026.02.29")).toBe(false)
    expect(isTemplateVersion("2024.02.29")).toBe(true)
    expect(isTemplateVersion("2026.8.12")).toBe(false)
    expect(isTemplateVersion("2026.08.12.0")).toBe(false)
    expect(isTemplateVersion(20260812)).toBe(false)
  })
})
