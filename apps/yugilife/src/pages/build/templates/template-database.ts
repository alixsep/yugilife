const databaseName = "yugilife-template-cache"
// Version 3 drops the "prepared-textures" store that version 2 added: the renderer grades
// textures itself now, so browsers that kept graded textures get that space back.
const databaseVersion = 3

export const templateStore = "templates"
const retiredStores = ["prepared-textures"]

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
      for (const store of retiredStores) {
        if (database.objectStoreNames.contains(store)) database.deleteObjectStore(store)
      }
    })
    request.addEventListener("success", () => resolve(request.result))
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("Unable to open the template cache")),
    )
  })
}
