import type { EditorDocumentState } from "../editor/model/editor-document"
import type { LayerVisibility } from "yugilife-core"

export const currentEditorDocumentVersion = 22

type PersistedEditorDocument = Partial<EditorDocumentState>
export interface EditorDocumentMigrationContext {
  defaultLayerVisibility: LayerVisibility
  defaultPresets: Readonly<Record<string, string | undefined>>
}
type DocumentMigration = (
  state: PersistedEditorDocument,
  context: EditorDocumentMigrationContext,
) => PersistedEditorDocument

function normalizeSparseOverrides(
  state: PersistedEditorDocument,
  context: EditorDocumentMigrationContext,
): PersistedEditorDocument {
  return {
    ...state,
    layers: Object.fromEntries(
      Object.entries(state.layers ?? {}).filter(
        ([id, visible]) => visible !== context.defaultLayerVisibility[id],
      ),
    ),
    presetOverrides: Object.fromEntries(
      Object.entries(state.presetOverrides ?? {}).filter(
        ([target, preset]) => preset !== context.defaultPresets[target],
      ),
    ),
  }
}

const identity: DocumentMigration = (state) => state
const addArtworkMaskState: DocumentMigration = (state) => ({
  ...state,
  artworkMask: state.artworkMask ?? { mode: "automatic", points: [] },
})
export function moveLegacyArtworkMaskEffects(
  state: PersistedEditorDocument,
): PersistedEditorDocument {
  type PersistedMaskEffects = NonNullable<PersistedEditorDocument["artworkMaskEffects"]>
  const presentation = state.presentationOverrides
  if (!presentation || typeof presentation !== "object" || Array.isArray(presentation)) {
    return { ...state, artworkMaskEffects: state.artworkMaskEffects ?? {} }
  }
  const legacy = (presentation as Record<string, unknown>).artworkMaskEffects as
    PersistedMaskEffects | undefined
  const existing = state.artworkMaskEffects
  const nextPresentation = { ...(presentation as Record<string, unknown>) }
  delete nextPresentation.artworkMaskEffects
  // An already-migrated document wins; the misplaced copy only fills an absent or empty map.
  const hasExisting = existing !== undefined && Object.keys(existing).length > 0
  return {
    ...state,
    artworkMaskEffects: hasExisting ? existing : (legacy ?? existing ?? {}),
    presentationOverrides: nextPresentation,
  }
}
export function moveLegacyArtworkTransformMode(
  state: PersistedEditorDocument,
): PersistedEditorDocument {
  const presentation = state.presentationOverrides
  if (!presentation || typeof presentation !== "object" || Array.isArray(presentation)) return state
  const transforms = (presentation as Record<string, unknown>).artworkTransforms
  if (!transforms || typeof transforms !== "object" || Array.isArray(transforms)) return state

  let changed = false
  const migratedTransforms = Object.fromEntries(
    Object.entries(transforms).map(([id, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [id, value]
      const legacy = value as Record<string, unknown>
      if (!("fullArt" in legacy)) return [id, value]
      changed = true
      const migrated = { ...legacy }
      delete migrated.fullArt
      if (legacy.fullArt === true && migrated.mode === undefined) migrated.mode = "full-art"
      return [id, migrated]
    }),
  )
  if (!changed) return state
  return {
    ...state,
    presentationOverrides: {
      ...presentation,
      artworkTransforms: migratedTransforms,
    },
  }
}
const documentMigrations = new Map<number, DocumentMigration>([
  ...Array.from({ length: 16 }, (_, index) => [index + 1, identity] as const),
  [17, normalizeSparseOverrides],
  [18, addArtworkMaskState],
  [19, moveLegacyArtworkMaskEffects],
  [20, identity],
  [21, moveLegacyArtworkTransformMode],
])

/** Upgrades only the editor document schema; template content is handled by a separate pipeline. */
export function migrateEditorDocumentSchema(
  persisted: unknown,
  sourceVersion: number,
  context: EditorDocumentMigrationContext,
): PersistedEditorDocument {
  if (!Number.isInteger(sourceVersion) || sourceVersion < 1) {
    throw new Error(`Unsupported editor document schema version ${String(sourceVersion)}.`)
  }
  if (sourceVersion > currentEditorDocumentVersion) {
    throw new Error(
      `Editor document schema version ${sourceVersion} is newer than supported version ${currentEditorDocumentVersion}.`,
    )
  }
  if (persisted === null || typeof persisted !== "object" || Array.isArray(persisted)) {
    throw new Error("Persisted editor document must be an object.")
  }

  let state = { ...(persisted as PersistedEditorDocument) }
  for (let version = sourceVersion; version < currentEditorDocumentVersion; version += 1) {
    const migrate = documentMigrations.get(version)
    if (!migrate) throw new Error(`Missing editor document migration ${version} -> ${version + 1}.`)
    state = migrate(state, context)
  }
  return state
}
