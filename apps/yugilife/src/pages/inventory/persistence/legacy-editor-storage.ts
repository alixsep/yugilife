import {
  editorDefaultLayerVisibility,
  editorPresetTargets,
} from "../../build/editor/model/editor-config"
import { createInitialEditorDocument } from "../../build/editor/model/editor-store"
import { migrateEditorDocumentSchema } from "../../build/migrations/document"
import { isTemplateVersion } from "../../build/migrations/template"

import type { EditorDocumentState } from "../../build/editor/model/editor-document"

const legacyDatabaseName = "yugilife-build-state"
const legacyStoreName = "zustand"
const legacyRecordName = "editor"

interface LegacyRecord {
  name: string
  value: {
    state: unknown
    version: number
  }
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true })
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("Legacy editor storage request failed")),
      { once: true },
    )
  })
}

async function openLegacyDatabase() {
  if (typeof indexedDB === "undefined") return undefined
  if (indexedDB.databases) {
    const databases = await indexedDB.databases()
    if (!databases.some(({ name }) => name === legacyDatabaseName)) return undefined
  }
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(legacyDatabaseName)
    request.addEventListener("success", () => resolve(request.result), { once: true })
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("Unable to open the legacy editor database")),
      { once: true },
    )
  })
}

function isLegacyRecord(value: unknown): value is LegacyRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const record = value as Partial<LegacyRecord>
  return (
    record.name === legacyRecordName &&
    typeof record.value === "object" &&
    record.value !== null &&
    Number.isInteger(record.value.version)
  )
}

export async function readLegacyEditorDocument(): Promise<
  | {
      document: EditorDocumentState
      remove: () => Promise<void>
    }
  | undefined
> {
  const database = await openLegacyDatabase()
  if (!database || !database.objectStoreNames.contains(legacyStoreName)) return undefined
  try {
    const read = database.transaction(legacyStoreName, "readonly")
    const value = await requestResult(
      read.objectStore(legacyStoreName).get(legacyRecordName) as IDBRequest<unknown>,
    )
    if (!isLegacyRecord(value)) return undefined
    const migrated = migrateEditorDocumentSchema(value.value.state, value.value.version, {
      defaultLayerVisibility: editorDefaultLayerVisibility,
      defaultPresets: Object.fromEntries(
        editorPresetTargets.map(({ defaultPreset, target }) => [target, defaultPreset]),
      ),
    })
    if (typeof migrated.templateId !== "string" || !isTemplateVersion(migrated.templateVersion)) {
      return undefined
    }
    const initial = createInitialEditorDocument()
    const document: EditorDocumentState = {
      ...initial,
      ...migrated,
      card: { ...initial.card, ...migrated.card },
      layers: migrated.layers ?? {},
      presetOverrides: migrated.presetOverrides ?? {},
      presentationOverrides: migrated.presentationOverrides ?? {},
      templateId: migrated.templateId,
      templateVersion: migrated.templateVersion,
    }

    return {
      document,
      async remove() {
        const removalDatabase = await openLegacyDatabase()
        if (!removalDatabase || !removalDatabase.objectStoreNames.contains(legacyStoreName)) return
        try {
          const remove = removalDatabase.transaction(legacyStoreName, "readwrite")
          remove.objectStore(legacyStoreName).delete(legacyRecordName)
          await new Promise<void>((resolve, reject) => {
            remove.addEventListener("complete", () => resolve(), { once: true })
            remove.addEventListener(
              "error",
              () => reject(remove.error ?? new Error("Could not remove legacy editor state")),
              { once: true },
            )
            remove.addEventListener(
              "abort",
              () => reject(remove.error ?? new Error("Legacy editor state removal aborted")),
              { once: true },
            )
          })
        } finally {
          removalDatabase.close()
        }
      },
    }
  } finally {
    database.close()
  }
}
