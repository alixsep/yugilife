export interface ReferenceTransform {
  rotation: number
  scaleX: number
  scaleY: number
  x: number
  y: number
}

export type ComparisonMode = "overlay" | "side-by-side"

export const defaultReferenceTransform: ReferenceTransform = {
  rotation: 0,
  scaleX: 100,
  scaleY: 100,
  x: 0,
  y: 0,
}

const referenceTransformsKey = "yugilife.reference-transforms"
const comparisonModeKey = "yugilife.reference-comparison-mode"
const referenceOpacityKey = "yugilife.reference-opacity"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function localStorageOrUndefined() {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function normalizeReferenceTransform(value: unknown): ReferenceTransform | undefined {
  if (!isRecord(value)) return undefined
  const { rotation, scale, scaleX, scaleY, x, y } = value
  const resolvedScaleX = finiteNumber(scaleX) ? scaleX : scale
  const resolvedScaleY = finiteNumber(scaleY) ? scaleY : scale
  if (
    !finiteNumber(rotation) ||
    !finiteNumber(resolvedScaleX) ||
    resolvedScaleX <= 0 ||
    !finiteNumber(resolvedScaleY) ||
    resolvedScaleY <= 0 ||
    !finiteNumber(x) ||
    !finiteNumber(y)
  ) {
    return undefined
  }
  return { rotation, scaleX: resolvedScaleX, scaleY: resolvedScaleY, x, y }
}

function settingError(subject: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error)
  return `${subject}: ${detail}`
}

export function readReferenceTransforms(): Record<string, ReferenceTransform> {
  const storage = localStorageOrUndefined()
  if (!storage) return {}
  try {
    const parsed: unknown = JSON.parse(storage.getItem(referenceTransformsKey) ?? "{}")
    if (!isRecord(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([id, transform]) => {
        const normalized = normalizeReferenceTransform(transform)
        return normalized ? [[id, normalized]] : []
      }),
    )
  } catch {
    return {}
  }
}

export function writeReferenceTransform(id: string, transform?: ReferenceTransform) {
  const storage = localStorageOrUndefined()
  if (!storage) return "Reference settings cannot be saved because local storage is unavailable."
  if (transform !== undefined && !normalizeReferenceTransform(transform)) {
    return "Reference settings contain an invalid transform."
  }
  try {
    const transforms = readReferenceTransforms()
    if (transform) transforms[id] = transform
    else delete transforms[id]
    storage.setItem(referenceTransformsKey, JSON.stringify(transforms))
  } catch (error) {
    return settingError("Reference settings could not be saved", error)
  }
  return undefined
}

export function readComparisonMode(): ComparisonMode {
  const storage = localStorageOrUndefined()
  try {
    return storage?.getItem(comparisonModeKey) === "side-by-side" ? "side-by-side" : "overlay"
  } catch {
    return "overlay"
  }
}

export function writeComparisonMode(mode: ComparisonMode) {
  const storage = localStorageOrUndefined()
  if (!storage) return "Comparison settings cannot be saved because local storage is unavailable."
  if (mode !== "overlay" && mode !== "side-by-side") {
    return "Comparison settings contain an invalid mode."
  }
  try {
    storage.setItem(comparisonModeKey, mode)
  } catch (error) {
    return settingError("Comparison settings could not be saved", error)
  }
  return undefined
}

export function readReferenceOpacity() {
  const storage = localStorageOrUndefined()
  try {
    const stored = Number(storage?.getItem(referenceOpacityKey))
    return Number.isFinite(stored) && stored >= 0 && stored <= 100 ? stored : 50
  } catch {
    return 50
  }
}

export function writeReferenceOpacity(opacity: number) {
  const storage = localStorageOrUndefined()
  if (!storage) return "Reference settings cannot be saved because local storage is unavailable."
  if (!finiteNumber(opacity) || opacity < 0 || opacity > 100) {
    return "Reference settings contain an invalid opacity."
  }
  try {
    storage.setItem(referenceOpacityKey, String(opacity))
  } catch (error) {
    return settingError("Reference settings could not be saved", error)
  }
  return undefined
}
