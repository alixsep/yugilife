import { deletePreparedTextures, preparedTextureCacheBytes } from "./prepared-texture-storage"
import {
  openTemplateDatabase,
  requestResult,
  templateStore,
  transactionComplete,
} from "./template-database"

import type { AssetSource, CardTemplateBundle, TemplateId } from "yugilife-core"

const memoryTemplates = new Map<TemplateId, StoredTemplateRecord>()

export type TemplateStorageMode = "indexeddb" | "memory"
let storageMode: TemplateStorageMode = typeof indexedDB === "undefined" ? "memory" : "indexeddb"

export function getTemplateStorageMode() {
  return storageMode
}

function switchToMemoryStorage() {
  storageMode = "memory"
}

export type TemplateRecordSource = "official" | "user"

export interface StoredTemplateRecord {
  bundle: CardTemplateBundle
  id: TemplateId
  sizeBytes: number
  source: TemplateRecordSource
  storedAt: number
  version: string
}

export function templateBundleMatchesVersion(
  bundle: Pick<CardTemplateBundle, "manifest"> | undefined,
  id: TemplateId,
  version: string | undefined,
) {
  return bundle?.manifest.id === id && bundle.manifest.version === version
}

interface PersistedTemplateRecord extends Omit<StoredTemplateRecord, "source"> {
  source?: TemplateRecordSource
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export interface OriginStorageEstimate {
  quota?: number
  usage?: number
}

export interface TemplateStorageSnapshot {
  originStorage: OriginStorageEstimate
  /** Bytes held by textures graded once per template release, beside the bundles themselves. */
  preparedTextureBytes: number
  storageMode: TemplateStorageMode
  templates: readonly StoredTemplateRecord[]
}

function sourceSize(source: AssetSource) {
  return typeof Blob !== "undefined" && source instanceof Blob ? source.size : 0
}

function normalizeRecord(record: PersistedTemplateRecord): StoredTemplateRecord {
  return { ...record, source: record.source === "user" ? "user" : "official" }
}

function isPersistedTemplateRecord(value: unknown): value is PersistedTemplateRecord {
  if (!isRecord(value)) return false
  const bundle = value.bundle
  if (!isRecord(bundle)) return false
  const manifest = bundle.manifest
  if (!isRecord(manifest)) return false
  if (
    typeof value.id !== "string" ||
    (value.source !== undefined && value.source !== "official" && value.source !== "user") ||
    !Number.isFinite(value.sizeBytes) ||
    Number(value.sizeBytes) < 0 ||
    !Number.isFinite(value.storedAt) ||
    !isTemplateVersion(value.version) ||
    typeof manifest.id !== "string" ||
    manifest.id !== value.id ||
    typeof manifest.name !== "string" ||
    manifest.name.length === 0 ||
    manifest.version !== value.version
  ) {
    return false
  }
  return true
}

export function templateBundleSize(bundle: CardTemplateBundle) {
  return Object.values(bundle.assets).reduce((total, source) => total + sourceSize(source), 0)
}

async function listStoredTemplatesFromIndexedDb() {
  const database = await openTemplateDatabase()
  try {
    const transaction = database.transaction(templateStore, "readonly")
    const records = await requestResult(
      transaction.objectStore(templateStore).getAll() as IDBRequest<PersistedTemplateRecord[]>,
    )
    await transactionComplete(transaction)
    return records
      .filter(isPersistedTemplateRecord)
      .map(normalizeRecord)
      .sort((left, right) => left.id.localeCompare(right.id))
  } finally {
    database.close()
  }
}

export async function listStoredTemplates() {
  if (storageMode === "memory") {
    return [...memoryTemplates.values()].sort((left, right) => left.id.localeCompare(right.id))
  }
  try {
    const records = await listStoredTemplatesFromIndexedDb()
    records.forEach((record) => memoryTemplates.set(record.id, record))
    return records
  } catch {
    switchToMemoryStorage()
    return [...memoryTemplates.values()].sort((left, right) => left.id.localeCompare(right.id))
  }
}

async function readStoredTemplateFromIndexedDb(id: TemplateId) {
  const database = await openTemplateDatabase()
  try {
    const transaction = database.transaction(templateStore, "readonly")
    const record = await requestResult(
      transaction.objectStore(templateStore).get(id) as IDBRequest<
        PersistedTemplateRecord | undefined
      >,
    )
    await transactionComplete(transaction)
    return record && isPersistedTemplateRecord(record) ? normalizeRecord(record) : undefined
  } finally {
    database.close()
  }
}

export async function readStoredTemplate(id: TemplateId) {
  if (storageMode === "memory") return memoryTemplates.get(id)
  try {
    const record = await readStoredTemplateFromIndexedDb(id)
    if (record) memoryTemplates.set(record.id, record)
    return record
  } catch {
    switchToMemoryStorage()
    return memoryTemplates.get(id)
  }
}

export async function storeTemplate(
  bundle: CardTemplateBundle,
  source: TemplateRecordSource = "official",
) {
  // Whatever textures were held for this ID were graded from the bundle this one replaces. Their
  // version cannot be trusted to have moved: editing a user template keeps its identity, and may
  // rewrite the very color presets those textures were graded with.
  await deletePreparedTextures(bundle.manifest.id)
  const record: StoredTemplateRecord = {
    bundle,
    id: bundle.manifest.id,
    sizeBytes: templateBundleSize(bundle),
    source,
    storedAt: Date.now(),
    version: bundle.manifest.version,
  }
  if (storageMode === "memory") {
    memoryTemplates.set(record.id, record)
    return record
  }
  try {
    const database = await openTemplateDatabase()
    try {
      const transaction = database.transaction(templateStore, "readwrite")
      transaction.objectStore(templateStore).put(record)
      await transactionComplete(transaction)
      memoryTemplates.set(record.id, record)
      return record
    } finally {
      database.close()
    }
  } catch {
    switchToMemoryStorage()
    memoryTemplates.set(record.id, record)
    return record
  }
}

export async function deleteStoredTemplate(id: TemplateId) {
  // Textures are derived from the bundle being removed, so they go with it.
  await deletePreparedTextures(id)
  if (storageMode === "memory") {
    memoryTemplates.delete(id)
    return
  }
  try {
    const database = await openTemplateDatabase()
    try {
      const transaction = database.transaction(templateStore, "readwrite")
      transaction.objectStore(templateStore).delete(id)
      await transactionComplete(transaction)
      memoryTemplates.delete(id)
    } finally {
      database.close()
    }
  } catch (error: unknown) {
    switchToMemoryStorage()
    throw error instanceof Error ? error : new Error("Unable to delete the stored template.")
  }
}

async function estimateOriginStorage(): Promise<OriginStorageEstimate> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return {}
  try {
    const estimate = await navigator.storage.estimate()
    return {
      ...(estimate.quota === undefined ? {} : { quota: estimate.quota }),
      ...(estimate.usage === undefined ? {} : { usage: estimate.usage }),
    }
  } catch {
    return {}
  }
}

export async function readTemplateStorageSnapshot(): Promise<TemplateStorageSnapshot> {
  const [templates, originStorage, preparedTextureBytes] = await Promise.all([
    listStoredTemplates(),
    estimateOriginStorage(),
    preparedTextureCacheBytes(),
  ])
  return { originStorage, preparedTextureBytes, storageMode, templates }
}
import { isTemplateVersion } from "../migrations/template"
