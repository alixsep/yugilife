import { expect, test } from "@playwright/test"

import type { Page } from "@playwright/test"

/**
 * Prepared textures in a real browser.
 *
 * The unit suites run without IndexedDB and the template visual suite proves the pixels, so what is
 * left unproven is exactly this: that the store survives a structured clone, that a second visit
 * reuses it instead of grading again, that the card waits for it, and that a cache it cannot use
 * costs nothing but speed.
 */

const databaseName = "yugilife-template-cache"
const preparedStore = "prepared-textures"
const templateStore = "templates"
const templateId = "card/series-10"
const card = '[data-template="card/series-10"]'
const preparingProgress = '[role="progressbar"][aria-label="Preparing template textures"]'

interface StoredPayloadSummary {
  alphaSize: number
  colorSize: number
  colorType: string | undefined
  height: number
  key: string
  width: number
}

interface StoredRecordSummary {
  databaseVersion: number
  payloads: StoredPayloadSummary[]
  sizeBytes: number
  storedAt: number
  storeNames: string[]
  version: string
}

async function readPreparedTextures(page: Page) {
  return await page.evaluate(
    async ([name, store, id]) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name)
        request.addEventListener("success", () => resolve(request.result))
        request.addEventListener("error", () =>
          reject(request.error ?? new Error("IndexedDB request failed")),
        )
      })
      try {
        const storeNames = [...database.objectStoreNames]
        if (!storeNames.includes(store)) return undefined
        const record = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
          const request = database.transaction(store).objectStore(store).get(id)
          request.addEventListener("success", () =>
            resolve(request.result as Record<string, unknown> | undefined),
          )
          request.addEventListener("error", () =>
            reject(request.error ?? new Error("IndexedDB request failed")),
          )
        })
        if (!record) return undefined
        const payloads = record.payloads as {
          alpha?: Blob
          color: Blob
          height: number
          key: string
          width: number
        }[]
        return {
          databaseVersion: database.version,
          storeNames,
          storedAt: record.storedAt as number,
          sizeBytes: record.sizeBytes as number,
          version: record.version as string,
          payloads: payloads.map((payload) => ({
            alphaSize: payload.alpha?.size ?? 0,
            colorSize: payload.color.size,
            colorType: payload.color.type,
            height: payload.height,
            key: payload.key,
            width: payload.width,
          })),
        }
      } finally {
        database.close()
      }
    },
    [databaseName, preparedStore, templateId] as const,
  )
}

/** Records when the preparing progress and the card itself first appeared, in page time. */
async function recordActivationTimeline(page: Page) {
  await page.addInitScript(
    ([cardSelector, progressSelector]) => {
      const timeline: { card?: number; preparing?: number } = {}
      Object.defineProperty(window, "__activationTimeline", { value: timeline })
      const started = performance.now()
      const poll = () => {
        if (timeline.preparing === undefined && document.querySelector(progressSelector)) {
          timeline.preparing = performance.now() - started
        }
        if (timeline.card === undefined && document.querySelector(cardSelector)) {
          timeline.card = performance.now() - started
        }
        if (timeline.card === undefined) requestAnimationFrame(poll)
      }
      requestAnimationFrame(poll)
    },
    [card, preparingProgress] as const,
  )
}

function activationTimeline(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __activationTimeline: { card?: number; preparing?: number } })
        .__activationTimeline,
  )
}

test("grades a downloaded template once and reuses it on the next visit", async ({ page }) => {
  await page.goto("/build")
  await expect(page.locator(card)).toBeVisible()

  const prepared = await readPreparedTextures(page)
  expect(prepared).toBeDefined()
  const record = prepared as StoredRecordSummary
  expect(record.databaseVersion).toBe(2)
  expect(record.storeNames).toEqual(expect.arrayContaining([preparedStore, templateStore]))
  expect(record.version).toMatch(/^\d{4}\.\d{2}\.\d{2}/)

  // Every reachable frame and effect-box texture, each a losslessly encoded plane that survived the
  // structured clone as a Blob rather than an empty object.
  expect(record.payloads.length).toBeGreaterThan(0)
  expect(record.payloads.every(({ colorType }) => colorType === "image/png")).toBe(true)
  expect(record.payloads.every(({ colorSize }) => colorSize > 0)).toBe(true)
  expect(record.payloads.some(({ alphaSize }) => alphaSize > 0)).toBe(true)
  expect(new Set(record.payloads.map(({ key }) => key)).size).toBe(record.payloads.length)
  expect(record.sizeBytes).toBe(
    record.payloads.reduce((total, { alphaSize, colorSize }) => total + colorSize + alphaSize, 0),
  )

  await page.reload()
  await expect(page.locator(card)).toBeVisible()

  // A second grading pass would write a new record; the same timestamp means the stored one was
  // read back, validated against the active version, and drawn.
  const reused = (await readPreparedTextures(page)) as StoredRecordSummary
  expect(reused.storedAt).toBe(record.storedAt)
  expect(reused.payloads).toEqual(record.payloads)
})

test("keeps the card off screen until its textures are prepared", async ({ page }) => {
  await recordActivationTimeline(page)
  await page.goto("/build")
  await expect(page.locator(card)).toBeVisible()

  const timeline = await activationTimeline(page)
  expect(timeline.card).toBeDefined()
  // The determinate preparing bar exists only while textures are actually being graded. Seeing it
  // before the card is what makes this one render rather than a live-graded card redrawn later.
  expect(timeline.preparing).toBeDefined()
  expect(timeline.preparing!).toBeLessThanOrEqual(timeline.card!)
})

test("upgrades a template cache written before prepared textures existed", async ({ page }) => {
  await page.goto("/")
  await page.evaluate(
    async ([name, store]) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name)
        request.addEventListener("success", () => resolve())
        request.addEventListener("error", () =>
          reject(request.error ?? new Error("IndexedDB request failed")),
        )
        request.addEventListener("blocked", () => resolve())
      })
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name, 1)
        request.addEventListener("upgradeneeded", () =>
          request.result.createObjectStore(store, { keyPath: "id" }),
        )
        request.addEventListener("success", () => resolve(request.result))
        request.addEventListener("error", () =>
          reject(request.error ?? new Error("IndexedDB request failed")),
        )
      })
      database.close()
    },
    [databaseName, templateStore] as const,
  )

  await page.goto("/build")
  await expect(page.locator(card)).toBeVisible()

  const record = (await readPreparedTextures(page)) as StoredRecordSummary
  expect(record.databaseVersion).toBe(2)
  expect(record.storeNames).toEqual(expect.arrayContaining([preparedStore, templateStore]))
  expect(record.payloads.length).toBeGreaterThan(0)
})

test("renders the card when its stored textures cannot be decoded", async ({ page }) => {
  await page.goto("/build")
  await expect(page.locator(card)).toBeVisible()
  const record = (await readPreparedTextures(page)) as StoredRecordSummary

  // The real keys with unusable bytes: every lookup a render makes now finds a payload and fails to
  // decode it, which is the path a damaged cache actually takes.
  const damaged = record.payloads.map(({ height, key, width }) => ({ height, key, width }))
  await page.evaluate(
    async ([name, store, id, version, keys]) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name)
        request.addEventListener("success", () => resolve(request.result))
        request.addEventListener("error", () =>
          reject(request.error ?? new Error("IndexedDB request failed")),
        )
      })
      try {
        const transaction = database.transaction(store, "readwrite")
        transaction.objectStore(store).put({
          id,
          version,
          payloads: keys.map(({ height, key, width }) => ({
            key,
            color: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
            height,
            width,
          })),
          sizeBytes: 3 * keys.length,
          storedAt: Date.now(),
        })
        await new Promise<void>((resolve, reject) => {
          transaction.addEventListener("complete", () => resolve())
          transaction.addEventListener("error", () =>
            reject(transaction.error ?? new Error("IndexedDB transaction failed")),
          )
        })
      } finally {
        database.close()
      }
    },
    [databaseName, preparedStore, templateId, record.version, damaged] as const,
  )

  await page.reload()
  // Prepared textures are an acceleration, never a dependency: an undecodable plane costs the speed
  // it was meant to save and nothing else.
  await expect(page.locator(card)).toBeVisible()
  await expect(page.locator(`${card} svg`).first()).toBeVisible()
})
