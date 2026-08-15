import type { EditorDocumentState } from "../editor/model/editor-document"
import type { LayerVisibility } from "yugilife-core"

export const currentEditorDocumentVersion = 18

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
const documentMigrations = new Map<number, DocumentMigration>([
  ...Array.from({ length: 16 }, (_, index) => [index + 1, identity] as const),
  [17, normalizeSparseOverrides],
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
