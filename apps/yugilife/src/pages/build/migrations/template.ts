import type { EditorDocumentState } from "../editor/model/editor-document"

type PersistedEditorDocument = Omit<Partial<EditorDocumentState>, "templateVersion"> & {
  templateVersion?: unknown
}

const templateVersionPattern = /^\d{4}\.\d{2}\.\d{2}(?:\.[1-9]\d*)?$/

interface TemplateMigrationCheckpoint {
  /** Applies only to documents for this stable template identity. */
  readonly templateId: string
  /** Current published or GitHub-supported release that requires this persisted-data transform. */
  readonly releasedIn: string
  readonly migrate: (saved: PersistedEditorDocument) => PersistedEditorDocument
}

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

function withoutLayerMasks(
  overrides: NonNullable<PersistedEditorDocument["presentationOverrides"]>,
): NonNullable<PersistedEditorDocument["presentationOverrides"]> {
  return Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "layerMasks"))
}

/**
 * Single direct current-release transform: removes retired Link-arrow and Pendulum layer state
 * before current validation while preserving every unrelated authored value.
 */
function migrateSeries10CurrentRelease(saved: PersistedEditorDocument): PersistedEditorDocument {
  const layers = saved.layers
  const presentationOverrides = saved.presentationOverrides
  const layerMasks = saved.presentationOverrides?.layerMasks
  const hasRetiredLayer = layers ? Object.hasOwn(layers, "pendulumBorder") : false
  const hasRetiredLinkMask = layerMasks
    ? Object.values(layerMasks).some((maskId) => maskId === "link-arrows")
    : false
  const hasRetiredPendulumMask = layerMasks ? Object.hasOwn(layerMasks, "pendulumBorder") : false
  if (!hasRetiredLayer && !hasRetiredLinkMask && !hasRetiredPendulumMask) return saved

  const retainedLayerMasks = layerMasks
    ? Object.fromEntries(
        Object.entries(layerMasks).filter(
          ([layerId, maskId]) => layerId !== "pendulumBorder" && maskId !== "link-arrows",
        ),
      )
    : undefined

  return {
    ...saved,
    ...(layers
      ? {
          layers: Object.fromEntries(
            Object.entries(layers).filter(([layerId]) => layerId !== "pendulumBorder"),
          ),
        }
      : {}),
    ...(presentationOverrides
      ? {
          presentationOverrides: {
            ...withoutLayerMasks(presentationOverrides),
            // Sparse overrides omit what they do not set, so an emptied selection drops the key
            // instead of persisting it as an explicit `undefined`.
            ...(retainedLayerMasks && Object.keys(retainedLayerMasks).length > 0
              ? { layerMasks: retainedLayerMasks }
              : {}),
          },
        }
      : {}),
  }
}

/**
 * Intentionally sparse current-release compatibility checkpoints. Local calendar versions and
 * same-day development sequences do not get entries. When the supported template advances, update
 * this checkpoint and merge all required transforms into the one current-release migration above;
 * older documents migrate directly to the current version before validation.
 */
const templateMigrationCheckpoints: readonly TemplateMigrationCheckpoint[] = [
  {
    templateId: "card/series-10",
    releasedIn: "2026.09.23",
    migrate: migrateSeries10CurrentRelease,
  },
]

function applyTemplateVersionMigrations(
  saved: PersistedEditorDocument,
  sourceVersion: string,
  currentVersion: string,
) {
  return templateMigrationCheckpoints.reduce(
    (document, checkpoint) =>
      checkpoint.templateId === saved.templateId &&
      compareTemplateVersions(sourceVersion, checkpoint.releasedIn) < 0 &&
      compareTemplateVersions(checkpoint.releasedIn, currentVersion) <= 0
        ? checkpoint.migrate(document)
        : document,
    saved,
  )
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
  const migrated = applyTemplateVersionMigrations(saved, templateVersion, current.templateVersion)
  return { ...migrated, templateVersion: current.templateVersion }
}
