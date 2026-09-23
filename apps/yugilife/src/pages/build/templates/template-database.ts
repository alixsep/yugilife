/**
 * The one owner of the template cache database.
 *
 * Templates and their prepared textures live in separate object stores of the same database because
 * they share a lifecycle: prepared textures are derived from one exact bundle and are meaningless
 * without it, so replacing or deleting a template must be able to drop them in the same open
 * connection rather than racing a second database's upgrade.
 */
const databaseName = "yugilife-template-cache"
const databaseVersion = 2

export const templateStore = "templates"
export const preparedTextureStore = "prepared-textures"

export function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result))
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("IndexedDB request failed")),
    )
  })
}

export function transactionComplete(transaction: IDBTransaction) {
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

export function openTemplateDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable in this browser."))
      return
    }
    const request = indexedDB.open(databaseName, databaseVersion)
    request.addEventListener("upgradeneeded", () => {
      const database = request.result
      if (!database.objectStoreNames.contains(templateStore)) {
        database.createObjectStore(templateStore, { keyPath: "id" })
      }
      if (!database.objectStoreNames.contains(preparedTextureStore)) {
        database.createObjectStore(preparedTextureStore, { keyPath: "id" })
      }
    })
    request.addEventListener("success", () => resolve(request.result))
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("Unable to open the template cache")),
    )
  })
}
