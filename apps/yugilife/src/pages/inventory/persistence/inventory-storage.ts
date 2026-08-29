import { inventoryPreviewMatchesCard } from "../model/inventory-preview"

import type { EditorDocumentState } from "../../build/editor/model/editor-document"
import type {
  InventoryCard,
  InventoryCardPreview,
  InventoryCardSummary,
} from "../model/inventory-card"
import type { CardData, CardFieldValue } from "yugilife-core"

const databaseName = "yugilife-inventory"
const databaseVersion = 2
const cardStore = "cards"
const previewStore = "previews"
const assetStore = "assets"
const metadataStore = "metadata"
const assetReferenceFormat = "yugilife/card-asset-ref"
const bootstrapMetadataKey = "inventory-bootstrap"
const bootstrapRevision = 1

export type InventoryStorageMode = "indexeddb" | "memory"
let storageMode: InventoryStorageMode = typeof indexedDB === "undefined" ? "memory" : "indexeddb"

interface CardAssetReference {
  format: typeof assetReferenceFormat
  id: string
}

interface StoredCardAsset {
  id: string
  value: Blob
}

interface InventoryBootstrapMetadata {
  key: typeof bootstrapMetadataKey
  revision: typeof bootstrapRevision
  state: "complete" | "pending"
}

export interface InventorySeedSnapshot {
  card: InventoryCard
  preview: InventoryCardPreview
}

interface PersistedInventoryCard extends Omit<InventoryCard, "document"> {
  document: Omit<EditorDocumentState, "card"> & {
    card: Record<string, CardFieldValue | CardAssetReference>
  }
}

const memoryCards = new Map<string, PersistedInventoryCard>()
const memoryPreviews = new Map<string, InventoryCardPreview>()
const memoryAssets = new Map<string, Blob>()
const knownAssetIds = new WeakMap<Blob, string>()
let memoryBootstrapState: InventoryBootstrapMetadata["state"] = "pending"

function bootstrapMetadata(state: InventoryBootstrapMetadata["state"]): InventoryBootstrapMetadata {
  return { key: bootstrapMetadataKey, revision: bootstrapRevision, state }
}

function isPendingBootstrapMetadata(value: unknown): value is InventoryBootstrapMetadata {
  return (
    isRecord(value) &&
    value.key === bootstrapMetadataKey &&
    value.revision === bootstrapRevision &&
    value.state === "pending"
  )
}

function newestCreatedFirst(left: InventoryCardSummary, right: InventoryCardSummary) {
  return right.createdAt - left.createdAt || right.id.localeCompare(left.id)
}

export function getInventoryStorageMode() {
  return storageMode
}

function switchToMemoryStorage() {
  storageMode = "memory"
}

function createId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isAssetReference(value: unknown): value is CardAssetReference {
  return isRecord(value) && value.format === assetReferenceFormat && typeof value.id === "string"
}

function referencedAssetIds(cards: Iterable<PersistedInventoryCard>) {
  const referenced = new Set<string>()
  for (const card of cards) {
    Object.values(card.document.card).forEach((value) => {
      if (isAssetReference(value)) referenced.add(value.id)
    })
  }
  return referenced
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true })
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB request failed")),
      { once: true },
    )
  })
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true })
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("IndexedDB transaction aborted")),
      { once: true },
    )
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("IndexedDB transaction failed")),
      { once: true },
    )
  })
}

let databasePromise: Promise<IDBDatabase> | undefined

function openDatabase() {
  databasePromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion)
    request.addEventListener("upgradeneeded", (event) => {
      const database = request.result
      if (!database.objectStoreNames.contains(cardStore)) {
        const cards = database.createObjectStore(cardStore, { keyPath: "id" })
        cards.createIndex("updatedAt", "updatedAt")
      }
      if (!database.objectStoreNames.contains(previewStore)) {
        database.createObjectStore(previewStore, { keyPath: "cardId" })
      }
      if (!database.objectStoreNames.contains(assetStore)) {
        database.createObjectStore(assetStore, { keyPath: "id" })
      }
      const metadata = database.objectStoreNames.contains(metadataStore)
        ? request.transaction!.objectStore(metadataStore)
        : database.createObjectStore(metadataStore, { keyPath: "key" })
      // Only a database created by this schema is seed-eligible. Upgrading any existing database,
      // including one whose owner deliberately deleted every card, must never repopulate it.
      metadata.put(bootstrapMetadata(event.oldVersion === 0 ? "pending" : "complete"))
    })
    request.addEventListener("success", () => resolve(request.result), { once: true })
    request.addEventListener("error", () => {
      databasePromise = undefined
      reject(request.error ?? new Error("Unable to open the inventory database"))
    })
  })
  return databasePromise
}

function summary(record: PersistedInventoryCard): InventoryCardSummary {
  return {
    createdAt: record.createdAt,
    id: record.id,
    revision: record.revision,
    templateId: record.document.templateId,
    templateVersion: record.document.templateVersion,
    title: record.title,
    updatedAt: record.updatedAt,
  }
}

function validatePersistedCard(record: unknown): record is PersistedInventoryCard {
  if (!isRecord(record) || !isRecord(record.document)) return false
  return (
    typeof record.id === "string" &&
    record.id.length > 0 &&
    typeof record.title === "string" &&
    Number.isInteger(record.revision) &&
    Number(record.revision) > 0 &&
    Number.isFinite(record.createdAt) &&
    Number.isFinite(record.updatedAt)
  )
}

function persistDocument(document: EditorDocumentState) {
  const assets: StoredCardAsset[] = []
  const card = Object.fromEntries(
    Object.entries(document.card).map(([field, value]) => {
      if (!(value instanceof Blob)) return [field, value]
      const id = knownAssetIds.get(value) ?? createId()
      knownAssetIds.set(value, id)
      assets.push({ id, value })
      return [field, { format: assetReferenceFormat, id } satisfies CardAssetReference]
    }),
  ) as PersistedInventoryCard["document"]["card"]
  return { assets, document: { ...document, card } }
}

async function hydrateDocument(
  document: PersistedInventoryCard["document"],
  readAsset: (id: string) => Promise<Blob | undefined>,
) {
  const entries = await Promise.all(
    Object.entries(document.card).map(async ([field, value]) => {
      if (!isAssetReference(value)) return [field, value] as const
      const asset = await readAsset(value.id)
      if (!asset) throw new Error(`Card artwork asset "${value.id}" is missing.`)
      knownAssetIds.set(asset, value.id)
      return [field, asset] as const
    }),
  )
  return { ...document, card: Object.fromEntries(entries) as CardData }
}

async function indexedDbAsset(id: string) {
  const database = await openDatabase()
  const transaction = database.transaction(assetStore, "readonly")
  const record = await requestResult(
    transaction.objectStore(assetStore).get(id) as IDBRequest<StoredCardAsset | undefined>,
  )
  if (record) memoryAssets.set(record.id, record.value)
  return record?.value
}

async function garbageCollectAssets() {
  if (storageMode === "memory") {
    const referenced = referencedAssetIds(memoryCards.values())
    for (const id of memoryAssets.keys()) {
      if (!referenced.has(id)) memoryAssets.delete(id)
    }
    return
  }
  const database = await openDatabase()
  const readTransaction = database.transaction([cardStore, assetStore], "readonly")
  const [cards, assetIds] = await Promise.all([
    requestResult(
      readTransaction.objectStore(cardStore).getAll() as IDBRequest<PersistedInventoryCard[]>,
    ),
    requestResult(readTransaction.objectStore(assetStore).getAllKeys()),
  ])
  const referenced = referencedAssetIds(cards.filter(validatePersistedCard))
  const orphaned = assetIds.filter(
    (id): id is string => typeof id === "string" && !referenced.has(id),
  )
  orphaned.forEach((id) => memoryAssets.delete(id))
  if (orphaned.length === 0) return
  const writeTransaction = database.transaction(assetStore, "readwrite")
  orphaned.forEach((id) => writeTransaction.objectStore(assetStore).delete(id))
  await transactionComplete(writeTransaction)
}

export async function listInventoryCards(): Promise<readonly InventoryCardSummary[]> {
  if (storageMode === "memory") {
    return [...memoryCards.values()].map(summary).sort(newestCreatedFirst)
  }
  try {
    const database = await openDatabase()
    const transaction = database.transaction(cardStore, "readonly")
    const records = await requestResult(
      transaction.objectStore(cardStore).getAll() as IDBRequest<PersistedInventoryCard[]>,
    )
    const validRecords = records.filter(validatePersistedCard)
    validRecords.forEach((record) => memoryCards.set(record.id, record))
    return validRecords.map(summary).sort(newestCreatedFirst)
  } catch {
    switchToMemoryStorage()
    return [...memoryCards.values()].map(summary).sort(newestCreatedFirst)
  }
}

export async function readInventoryCard(id: string): Promise<InventoryCard | undefined> {
  try {
    let record: PersistedInventoryCard | undefined
    if (storageMode === "memory") record = memoryCards.get(id)
    else {
      const database = await openDatabase()
      const transaction = database.transaction(cardStore, "readonly")
      const value = await requestResult(
        transaction.objectStore(cardStore).get(id) as IDBRequest<unknown>,
      )
      record = validatePersistedCard(value) ? value : undefined
      if (record) memoryCards.set(record.id, record)
    }
    if (!record) return undefined
    const document = await hydrateDocument(record.document, async (assetId) =>
      storageMode === "memory" ? memoryAssets.get(assetId) : indexedDbAsset(assetId),
    )
    return { ...record, document }
  } catch (error) {
    if (storageMode === "memory") throw error
    switchToMemoryStorage()
    return readInventoryCard(id)
  }
}

export async function createInventoryCard(document: EditorDocumentState, title = "Untitled card") {
  const now = Date.now()
  const card: InventoryCard = {
    createdAt: now,
    document,
    id: createId(),
    revision: 1,
    title,
    updatedAt: now,
  }
  await saveInventoryCard(card)
  return card
}

export async function saveInventoryCard(card: InventoryCard) {
  const persisted = persistDocument(card.document)
  const record: PersistedInventoryCard = { ...card, document: persisted.document }
  if (storageMode === "memory") {
    persisted.assets.forEach(({ id, value }) => memoryAssets.set(id, value))
    memoryCards.set(record.id, record)
    memoryBootstrapState = "complete"
    await garbageCollectAssets()
    return card
  }
  try {
    const database = await openDatabase()
    const transaction = database.transaction([cardStore, assetStore, metadataStore], "readwrite")
    persisted.assets.forEach((asset) => transaction.objectStore(assetStore).put(asset))
    transaction.objectStore(cardStore).put(record)
    transaction.objectStore(metadataStore).put(bootstrapMetadata("complete"))
    await transactionComplete(transaction)
    persisted.assets.forEach(({ id, value }) => memoryAssets.set(id, value))
    memoryCards.set(record.id, record)
    memoryBootstrapState = "complete"
    await garbageCollectAssets()
    return card
  } catch {
    switchToMemoryStorage()
    persisted.assets.forEach(({ id, value }) => memoryAssets.set(id, value))
    memoryCards.set(record.id, record)
    memoryBootstrapState = "complete"
    await garbageCollectAssets()
    return card
  }
}

/** Commits authored card data and its matching rendered preview as one inventory snapshot. */
export async function saveInventoryCardSnapshot(
  card: InventoryCard,
  preview: InventoryCardPreview,
) {
  if (preview.cardId !== card.id || preview.cardRevision !== card.revision) {
    throw new Error("The inventory preview does not match the card snapshot being saved.")
  }
  const persisted = persistDocument(card.document)
  const record: PersistedInventoryCard = { ...card, document: persisted.document }
  if (storageMode === "memory") {
    persisted.assets.forEach(({ id, value }) => memoryAssets.set(id, value))
    memoryCards.set(record.id, record)
    memoryPreviews.set(preview.cardId, preview)
    memoryBootstrapState = "complete"
    await garbageCollectAssets()
    return card
  }
  try {
    const database = await openDatabase()
    const transaction = database.transaction(
      [cardStore, previewStore, assetStore, metadataStore],
      "readwrite",
    )
    persisted.assets.forEach((asset) => transaction.objectStore(assetStore).put(asset))
    transaction.objectStore(cardStore).put(record)
    transaction.objectStore(previewStore).put(preview)
    transaction.objectStore(metadataStore).put(bootstrapMetadata("complete"))
    await transactionComplete(transaction)
    persisted.assets.forEach(({ id, value }) => memoryAssets.set(id, value))
    memoryCards.set(record.id, record)
    memoryPreviews.set(preview.cardId, preview)
    memoryBootstrapState = "complete"
    await garbageCollectAssets()
    return card
  } catch {
    switchToMemoryStorage()
    persisted.assets.forEach(({ id, value }) => memoryAssets.set(id, value))
    memoryCards.set(record.id, record)
    memoryPreviews.set(preview.cardId, preview)
    memoryBootstrapState = "complete"
    await garbageCollectAssets()
    return card
  }
}

function prepareSeedSnapshots(snapshots: readonly InventorySeedSnapshot[]) {
  if (snapshots.length === 0) throw new Error("The inventory seed must contain at least one card.")
  const ids = new Set<string>()
  return snapshots.map(({ card, preview }) => {
    if (ids.has(card.id)) throw new Error(`The inventory seed repeats card ID "${card.id}".`)
    ids.add(card.id)
    if (preview.cardId !== card.id || preview.cardRevision !== card.revision) {
      throw new Error(`The inventory seed preview for "${card.title}" does not match its card.`)
    }
    const persisted = persistDocument(card.document)
    return {
      assets: persisted.assets,
      preview,
      record: { ...card, document: persisted.document } satisfies PersistedInventoryCard,
    }
  })
}

async function inventoryBootstrapIsPending() {
  if (storageMode === "memory") {
    if (memoryCards.size > 0) memoryBootstrapState = "complete"
    return memoryBootstrapState === "pending"
  }
  try {
    const database = await openDatabase()
    const transaction = database.transaction(metadataStore, "readonly")
    const metadata = await requestResult(
      transaction.objectStore(metadataStore).get(bootstrapMetadataKey) as IDBRequest<unknown>,
    )
    return isPendingBootstrapMetadata(metadata)
  } catch {
    switchToMemoryStorage()
    return inventoryBootstrapIsPending()
  }
}

function seedMemoryInventory(prepared: ReturnType<typeof prepareSeedSnapshots>) {
  if (memoryBootstrapState !== "pending") return false
  if (memoryCards.size > 0) {
    memoryBootstrapState = "complete"
    return false
  }
  prepared.forEach(({ assets, preview, record }) => {
    assets.forEach(({ id, value }) => memoryAssets.set(id, value))
    memoryCards.set(record.id, record)
    memoryPreviews.set(preview.cardId, preview)
  })
  memoryBootstrapState = "complete"
  return true
}

/**
 * Atomically installs the product's starter collection only for a database created as pristine.
 * Existing databases are permanently ineligible, even when their owner has deleted every card.
 */
export async function seedInventoryIfPristine(
  createSnapshots: () => Promise<readonly InventorySeedSnapshot[]>,
) {
  if (!(await inventoryBootstrapIsPending())) return false
  const prepared = prepareSeedSnapshots(await createSnapshots())
  if (storageMode === "memory") return seedMemoryInventory(prepared)

  try {
    const database = await openDatabase()
    const transaction = database.transaction(
      [cardStore, previewStore, assetStore, metadataStore],
      "readwrite",
    )
    const metadataObjectStore = transaction.objectStore(metadataStore)
    const [metadata, cardCount] = await Promise.all([
      requestResult(metadataObjectStore.get(bootstrapMetadataKey) as IDBRequest<unknown>),
      requestResult(transaction.objectStore(cardStore).count()),
    ])
    const shouldSeed = isPendingBootstrapMetadata(metadata) && cardCount === 0
    if (shouldSeed) {
      prepared.forEach(({ assets, preview, record }) => {
        assets.forEach((asset) => transaction.objectStore(assetStore).put(asset))
        transaction.objectStore(cardStore).put(record)
        transaction.objectStore(previewStore).put(preview)
      })
    }
    if (isPendingBootstrapMetadata(metadata)) {
      metadataObjectStore.put(bootstrapMetadata("complete"))
    }
    await transactionComplete(transaction)
    memoryBootstrapState = "complete"
    if (!shouldSeed) return false
    prepared.forEach(({ assets, preview, record }) => {
      assets.forEach(({ id, value }) => memoryAssets.set(id, value))
      memoryCards.set(record.id, record)
      memoryPreviews.set(preview.cardId, preview)
    })
    return true
  } catch {
    switchToMemoryStorage()
    return seedMemoryInventory(prepared)
  }
}

export async function duplicateInventoryCard(id: string) {
  const source = await readInventoryCard(id)
  if (!source) throw new Error("The card to duplicate no longer exists.")
  const now = Date.now()
  const duplicate: InventoryCard = {
    createdAt: now,
    document: source.document,
    id: createId(),
    revision: 1,
    title: `${source.title} copy`,
    updatedAt: now,
  }
  const preview = await readInventoryPreview(source.id)
  if (
    preview &&
    inventoryPreviewMatchesCard(preview, {
      id: source.id,
      revision: source.revision,
      templateId: source.document.templateId,
      templateVersion: source.document.templateVersion,
    })
  ) {
    await saveInventoryCardSnapshot(duplicate, {
      ...preview,
      cardId: duplicate.id,
      cardRevision: duplicate.revision,
    })
  } else {
    await saveInventoryCard(duplicate)
  }
  return duplicate
}

export async function deleteInventoryCard(id: string) {
  if (storageMode === "memory") {
    memoryCards.delete(id)
    memoryPreviews.delete(id)
    await garbageCollectAssets()
    return
  }
  try {
    const database = await openDatabase()
    const transaction = database.transaction([cardStore, previewStore], "readwrite")
    transaction.objectStore(cardStore).delete(id)
    transaction.objectStore(previewStore).delete(id)
    await transactionComplete(transaction)
    memoryCards.delete(id)
    memoryPreviews.delete(id)
    await garbageCollectAssets()
  } catch (error: unknown) {
    switchToMemoryStorage()
    memoryCards.delete(id)
    memoryPreviews.delete(id)
    await garbageCollectAssets()
    throw error instanceof Error ? error : new Error("Unable to delete the inventory card.")
  }
}

export async function readInventoryPreview(id: string) {
  if (storageMode === "memory") return memoryPreviews.get(id)
  try {
    const database = await openDatabase()
    const transaction = database.transaction(previewStore, "readonly")
    const preview = await requestResult(
      transaction.objectStore(previewStore).get(id) as IDBRequest<InventoryCardPreview | undefined>,
    )
    if (preview) memoryPreviews.set(id, preview)
    return preview
  } catch {
    switchToMemoryStorage()
    return memoryPreviews.get(id)
  }
}

export async function storeInventoryPreview(preview: InventoryCardPreview) {
  if (storageMode === "memory") {
    memoryPreviews.set(preview.cardId, preview)
    return
  }
  try {
    const database = await openDatabase()
    const transaction = database.transaction(previewStore, "readwrite")
    transaction.objectStore(previewStore).put(preview)
    await transactionComplete(transaction)
    memoryPreviews.set(preview.cardId, preview)
  } catch {
    switchToMemoryStorage()
    memoryPreviews.set(preview.cardId, preview)
  }
}
