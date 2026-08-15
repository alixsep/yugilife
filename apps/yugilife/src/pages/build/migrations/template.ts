import type { EditorDocumentState } from "../editor/model/editor-document"

type PersistedEditorDocument = Omit<Partial<EditorDocumentState>, "templateVersion"> & {
  templateVersion?: unknown
}

const templateVersionPattern = /^\d{4}\.\d{2}\.\d{2}(?:\.[1-9]\d*)?$/

export function isTemplateVersion(value: unknown): value is string {
  if (typeof value !== "string" || !templateVersionPattern.test(value)) return false
  const [year, month, day] = value.split(".").map(Number)
  if (!year || !month || !day) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

function compareTemplateVersions(left: string, right: string) {
  const leftParts = left.split(".").map(Number)
  const rightParts = right.split(".").map(Number)
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/**
 * Advances an older document to the current release of the same stable template. The caller must
 * validate the migrated card, fields, layers, presets, and presentation overrides against the
 * current bundle before committing it. Numeric legacy, future, and different-template identities
 * remain unsupported.
 */
export function migrateEditorTemplateVersion(
  saved: PersistedEditorDocument,
  current: EditorDocumentState,
): Partial<EditorDocumentState> | undefined {
  const templateVersion = saved.templateVersion
  if (!isTemplateVersion(templateVersion)) return undefined
  if (saved.templateId !== current.templateId) return undefined
  if (compareTemplateVersions(templateVersion, current.templateVersion) > 0) return undefined
  return { ...saved, templateVersion: current.templateVersion }
}
