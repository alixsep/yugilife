import {
  currentEditorDocumentVersion,
  migrateEditorDocumentSchema,
} from "../../migrations/document"
import { migrateEditorTemplateVersion } from "../../migrations/template"
import {
  createInitialCard,
  editorDefaultLayerVisibility,
  editorPresetTargets,
  editorTemplateId,
  editorTemplateVersion,
} from "../model/editor-config"
import { validateEditorDocumentState } from "../model/editor-document-validation"

import type { EditorDocumentState } from "../model/editor-document"
import type { CardData, CardFieldValue } from "yugilife-core"

const editorDocumentFormat = "yugilife/editor-document"
export const maximumEditorDocumentBytes = 64 * 1024 * 1024

interface EditorDocumentFile {
  document: unknown
  format: typeof editorDocumentFormat
  schemaVersion: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const editorDocumentKeys = new Set([
  "card",
  "layers",
  "mode",
  "presetOverrides",
  "presentationOverrides",
  "templateId",
  "templateVersion",
])

const editorDocumentEnvelopeKeys = new Set(["document", "format", "schemaVersion"])

function assertKnownDocumentKeys(value: unknown) {
  if (!isRecord(value)) throw new Error("Editor document must be an object.")
  const unknown = Object.keys(value).find((key) => !editorDocumentKeys.has(key))
  if (unknown) throw new Error(`Editor document contains unsupported property "${unknown}".`)
}

function assertKnownEnvelopeKeys(value: unknown) {
  if (!isRecord(value)) throw new Error("Editor document envelope must be an object.")
  const unknown = Object.keys(value).find((key) => !editorDocumentEnvelopeKeys.has(key))
  if (unknown)
    throw new Error(`Editor document envelope contains unsupported property "${unknown}".`)
}

function blobDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener(
      "load",
      () => {
        if (typeof reader.result === "string") resolve(reader.result)
        else reject(new Error("Image encoding did not produce a data URL."))
      },
      { once: true },
    )
    reader.addEventListener(
      "error",
      () => reject(reader.error ?? new Error("Could not encode an image in the editor document.")),
      { once: true },
    )
    reader.readAsDataURL(blob)
  })
}

async function jsonCardValue(field: string, value: CardFieldValue): Promise<unknown> {
  if (value instanceof Blob) return await blobDataUrl(value)
  if (value instanceof URL) return value.href
  if (
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    Array.isArray(value)
  ) {
    return value
  }
  throw new Error(`Card field "${field}" contains an image source that JSON cannot represent.`)
}

async function jsonCard(card: CardData): Promise<Record<string, unknown>> {
  const entries = await Promise.all(
    Object.entries(card).map(async ([field, value]): Promise<readonly [string, unknown]> => [
      field,
      await jsonCardValue(field, value),
    ]),
  )
  return Object.fromEntries(entries)
}

export async function serializeEditorDocument(document: EditorDocumentState) {
  const file: EditorDocumentFile = {
    document: { ...document, card: await jsonCard(document.card) },
    format: editorDocumentFormat,
    schemaVersion: currentEditorDocumentVersion,
  }
  const source = `${JSON.stringify(file, null, 2)}\n`
  if (source.length > maximumEditorDocumentBytes) {
    throw new Error(
      `Editor documents must be smaller than ${maximumEditorDocumentBytes / 1024 / 1024} MiB.`,
    )
  }
  return source
}

const migrationContext = {
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

export function parseEditorDocument(source: string): EditorDocumentState {
  if (source.length > maximumEditorDocumentBytes) {
    throw new Error(
      `Editor documents must be smaller than ${maximumEditorDocumentBytes / 1024 / 1024} MiB.`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    throw new Error("The selected file is not valid JSON.", { cause: error })
  }
  if (!isRecord(parsed)) throw new Error("Editor document envelope must be an object.")
  assertKnownEnvelopeKeys(parsed)
  if (parsed.format !== editorDocumentFormat) {
    throw new Error(`Expected a ${editorDocumentFormat} document.`)
  }
  const schemaVersion = parsed.schemaVersion
  if (!Number.isInteger(schemaVersion)) {
    throw new Error("Editor document schemaVersion must be an integer.")
  }

  const initial = currentDocument()
  const documentShape = migrateEditorDocumentSchema(
    parsed.document,
    Number(schemaVersion),
    migrationContext,
  )
  const migrationTarget =
    typeof documentShape.templateId === "string" &&
    documentShape.templateId.startsWith("user/") &&
    isTemplateVersion(documentShape.templateVersion)
      ? {
          ...initial,
          templateId: documentShape.templateId,
          templateVersion: documentShape.templateVersion,
        }
      : initial
  const migrated = migrateEditorTemplateVersion(documentShape, migrationTarget)
  if (!migrated) {
    throw new Error("The editor document uses an unsupported template or template version.")
  }
  assertKnownDocumentKeys(migrated)
  if (!isRecord(migrated.card)) throw new Error("Editor document card must be an object.")
  if (typeof migrated.templateId !== "string" || migrated.templateId.length === 0) {
    throw new Error("Editor document templateId must be a non-empty string.")
  }
  const templateVersion = migrated.templateVersion
  if (!isTemplateVersion(templateVersion)) {
    throw new Error("Editor document templateVersion must use YYYY.MM.DD or YYYY.MM.DD.N.")
  }

  const document: EditorDocumentState = {
    card: { ...initial.card, ...migrated.card },
    layers: migrated.layers ?? {},
    mode: migrated.mode ?? "automatic",
    presetOverrides: migrated.presetOverrides ?? {},
    presentationOverrides: migrated.presentationOverrides ?? {},
    templateId: migrated.templateId,
    templateVersion,
  }
  try {
    return validateEditorDocumentState(document)
  } catch (error) {
    throw new Error("Editor document contains invalid editor state.", { cause: error })
  }
}
import { isTemplateVersion } from "../../migrations/template"
