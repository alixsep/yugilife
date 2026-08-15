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
    expect(currentEditorDocumentVersion).toBe(18)
  })

  it("rejects malformed and future document schema versions", () => {
    expect(() =>
      migrateEditorDocumentSchema({}, currentEditorDocumentVersion + 1, documentMigrationContext),
    ).toThrow(/newer than supported/)
    expect(() => migrateEditorDocumentSchema([], 1, documentMigrationContext)).toThrow(
      /must be an object/,
    )
  })

  it("migrates older releases of the same template and rejects future or different identities", () => {
    const saved = {
      card: { name: "Saved card" },
      templateId: editorTemplateId,
      templateVersion: editorTemplateVersion,
    }

    expect(migrateEditorTemplateVersion(saved, currentDocument())).toEqual(saved)
    expect(
      migrateEditorTemplateVersion(
        { ...saved, templateVersion: "2026.08.12.1" },
        currentDocument(),
      ),
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
