const databaseName = "yugilife-editor"
const databaseVersion = 1
const referenceStore = "references"

export interface StoredReferenceImage {
  blob: Blob
  createdAt: number
  id: string
  name: string
}

type StorageMode = "indexeddb" | "memory"

const memoryReferences = new Map<string, StoredReferenceImage>()
let storageMode: StorageMode = typeof indexedDB === "undefined" ? "memory" : "indexeddb"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStoredReferenceImage(value: unknown): value is StoredReferenceImage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    Number.isFinite(value.createdAt) &&
    typeof Blob !== "undefined" &&
    value.blob instanceof Blob
  )
}

function switchToMemoryStorage() {
  storageMode = "memory"
}

export function getReferenceStorageMode() {
  return storageMode
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

function openReferenceDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion)
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(referenceStore)) {
        request.result.createObjectStore(referenceStore, { keyPath: "id" })
      }
    })
    request.addEventListener("success", () => resolve(request.result))
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("Unable to open the reference database")),
    )
  })
}

export async function loadStoredReferences() {
  if (storageMode === "memory") {
    return [...memoryReferences.values()].sort((left, right) => left.createdAt - right.createdAt)
  }
  try {
    const database = await openReferenceDatabase()
    try {
      const transaction = database.transaction(referenceStore, "readonly")
      const references = await requestResult(
        transaction.objectStore(referenceStore).getAll() as IDBRequest<StoredReferenceImage[]>,
      )
      await transactionComplete(transaction)
      const validReferences = references.filter(isStoredReferenceImage)
      validReferences.forEach((reference) => memoryReferences.set(reference.id, reference))
      return validReferences.sort((left, right) => left.createdAt - right.createdAt)
    } finally {
      database.close()
    }
  } catch {
    switchToMemoryStorage()
    return [...memoryReferences.values()].sort((left, right) => left.createdAt - right.createdAt)
  }
}

export async function storeReference(reference: StoredReferenceImage) {
  if (storageMode === "memory") {
    memoryReferences.set(reference.id, reference)
    return
  }
  try {
    const database = await openReferenceDatabase()
    try {
      const transaction = database.transaction(referenceStore, "readwrite")
      transaction.objectStore(referenceStore).put(reference)
      await transactionComplete(transaction)
      memoryReferences.set(reference.id, reference)
    } finally {
      database.close()
    }
  } catch {
    switchToMemoryStorage()
    memoryReferences.set(reference.id, reference)
  }
}

export async function deleteStoredReference(id: string) {
  if (storageMode === "memory") {
    memoryReferences.delete(id)
    return
  }
  try {
    const database = await openReferenceDatabase()
    try {
      const transaction = database.transaction(referenceStore, "readwrite")
      transaction.objectStore(referenceStore).delete(id)
      await transactionComplete(transaction)
      memoryReferences.delete(id)
    } finally {
      database.close()
    }
  } catch (error: unknown) {
    switchToMemoryStorage()
    memoryReferences.delete(id)
    throw error instanceof Error ? error : new Error("Unable to delete the stored reference.")
  }
}
