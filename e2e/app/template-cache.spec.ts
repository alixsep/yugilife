import { expect, test } from "@playwright/test"

import type { Page } from "@playwright/test"

/**
 * The template cache's upgrades in a real browser, where users keep it across releases. Version 2
 * stored graded textures beside the templates; the renderer grades textures itself now, so version 3
 * drops that store and must leave the templates and the card working.
 */

const databaseName = "yugilife-template-cache"
const templateStore = "templates"
const retiredStore = "prepared-textures"
const card = '[data-template="card/series-10"]'

test.describe.configure({ timeout: 90_000 })

/** Replaces the template cache with one at `version` holding `stores`, as an earlier release left it. */
async function seedCache(page: Page, version: number, stores: readonly string[]) {
  await page.goto("/")
  await page.evaluate(
    async ([name, version, stores, retired]) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name)
        request.addEventListener("success", () => resolve())
        request.addEventListener("error", () =>
          reject(request.error ?? new Error("IndexedDB failed")),
        )
        request.addEventListener("blocked", () => resolve())
      })
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name, version)
        request.addEventListener("upgradeneeded", () => {
          for (const store of stores) request.result.createObjectStore(store, { keyPath: "id" })
        })
        request.addEventListener("success", () => resolve(request.result))
        request.addEventListener("error", () =>
          reject(request.error ?? new Error("IndexedDB failed")),
        )
      })
      if (stores.includes(retired)) {
        const transaction = database.transaction(retired, "readwrite")
        transaction.objectStore(retired).put({
          id: "card/series-10",
          payloads: [{ color: new Blob([new Uint8Array(1024)]), height: 1, key: "k", width: 1 }],
          version: "2026.09.23",
        })
        await new Promise<void>((resolve, reject) => {
          transaction.addEventListener("complete", () => resolve())
          transaction.addEventListener("error", () =>
            reject(transaction.error ?? new Error("IndexedDB failed")),
          )
        })
      }
      database.close()
    },
    [databaseName, version, stores, retiredStore] as const,
  )
}

async function readCache(page: Page) {
  return await page.evaluate(async (name) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name)
      request.addEventListener("success", () => resolve(request.result))
      request.addEventListener("error", () =>
        reject(request.error ?? new Error("IndexedDB failed")),
      )
    })
    try {
      return { storeNames: [...database.objectStoreNames].sort(), version: database.version }
    } finally {
      database.close()
    }
  }, databaseName)
}

test("drops the graded textures an earlier release stored", async ({ page }) => {
  await seedCache(page, 2, [templateStore, retiredStore])

  await page.goto("/build")
  await expect(page.locator(card)).toBeVisible({ timeout: 30_000 })

  expect(await readCache(page)).toEqual({ storeNames: [templateStore], version: 3 })
})

test("upgrades a cache from before graded textures were stored", async ({ page }) => {
  await seedCache(page, 1, [templateStore])

  await page.goto("/build")
  await expect(page.locator(card)).toBeVisible({ timeout: 30_000 })

  expect(await readCache(page)).toEqual({ storeNames: [templateStore], version: 3 })
})
