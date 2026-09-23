const databaseName = "yugilife-card-catalog"
const databaseVersion = 2
const catalogStore = "catalogs"
const maximumCompressedBytes = 2 * 1024 * 1024
const maximumUncompressedBytes = 8 * 1024 * 1024

export type CardCatalogStorageMode = "indexeddb" | "memory"

export interface CachedCardCatalog {
  artifactSha256: string
  catalogSha256: string
  compressedBytes: number
  data: Uint8Array
  recordCount: number
  storedAt: number
  uncompressedBytes: number
}

const memoryCatalogs = new Map<string, CachedCardCatalog>()
let storageMode: CardCatalogStorageMode = typeof indexedDB === "undefined" ? "memory" : "indexeddb"

export function getCardCatalogStorageMode() {
  return storageMode
}

function switchToMemory() {
  storageMode = "memory"
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result))
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("IndexedDB request failed")),
    )
  })
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve())
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted")),
    )
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed")),
    )
  })
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable in this browser."))
      return
    }
    const request = indexedDB.open(databaseName, databaseVersion)
    request.addEventListener("upgradeneeded", () => {
      if (request.result.objectStoreNames.contains(catalogStore)) {
        request.result.deleteObjectStore(catalogStore)
      }
      request.result.createObjectStore(catalogStore, { keyPath: "artifactSha256" })
    })
    request.addEventListener("success", () => resolve(request.result))
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("Unable to open the card catalog cache")),
    )
  })
}

function validHash(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
}

function validCount(value: unknown, maximum: number) {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum
}

function isCachedCardCatalog(value: unknown): value is CachedCardCatalog {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const record = value as Partial<CachedCardCatalog>
  return (
    validHash(record.artifactSha256) &&
    validHash(record.catalogSha256) &&
    validCount(record.compressedBytes, maximumCompressedBytes) &&
    validCount(record.uncompressedBytes, maximumUncompressedBytes) &&
    validCount(record.recordCount, 100_000) &&
    Number.isFinite(record.storedAt) &&
    record.data instanceof Uint8Array &&
    record.data.byteLength === record.compressedBytes
  )
}

async function readIndexedDbRecords() {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(catalogStore, "readonly")
    const records = await requestResult(
      transaction.objectStore(catalogStore).getAll() as IDBRequest<unknown[]>,
    )
    await transactionComplete(transaction)
    return records.filter(isCachedCardCatalog)
  } finally {
    database.close()
  }
}

async function records() {
  if (storageMode === "memory") return [...memoryCatalogs.values()]
  try {
    const stored = await readIndexedDbRecords()
    memoryCatalogs.clear()
    stored.forEach((record) => memoryCatalogs.set(record.artifactSha256, record))
    return stored
  } catch {
    switchToMemory()
    return [...memoryCatalogs.values()]
  }
}

export async function readCachedCardCatalog(artifactSha256: string) {
  return (await records()).find((candidate) => candidate.artifactSha256 === artifactSha256)
}

export async function readLatestCachedCardCatalog() {
  return (await records()).sort((left, right) => right.storedAt - left.storedAt)[0]
}

export async function storeCardCatalog(
  record: Omit<CachedCardCatalog, "data" | "storedAt"> & { data: Uint8Array },
) {
  const stored: CachedCardCatalog = {
    ...record,
    data: Uint8Array.from(record.data),
    storedAt: Date.now(),
  }
  if (!isCachedCardCatalog(stored)) throw new Error("Refusing to store an invalid card catalog")
  memoryCatalogs.clear()
  memoryCatalogs.set(stored.artifactSha256, stored)
  if (storageMode === "memory") return
  try {
    const database = await openDatabase()
    try {
      const transaction = database.transaction(catalogStore, "readwrite")
      const store = transaction.objectStore(catalogStore)
      store.clear()
      store.put(stored)
      await transactionComplete(transaction)
    } finally {
      database.close()
    }
  } catch {
    switchToMemory()
  }
}

export function resetCardCatalogStorageForTests() {
  memoryCatalogs.clear()
  storageMode = typeof indexedDB === "undefined" ? "memory" : "indexeddb"
}
