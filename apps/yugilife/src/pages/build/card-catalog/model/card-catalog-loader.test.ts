import { afterEach, expect, it, vi } from "vitest"

import { storeCardCatalog } from "../persistence/card-catalog-storage"

import {
  resetCardCatalogLoaderForTests,
  restoreCardCatalog,
  retryCardCatalogLoad,
  updateRestoredCardCatalog,
} from "./card-catalog-loader"

vi.mock("../persistence/card-catalog-storage", () => ({
  getCardCatalogStorageMode: () => "memory",
  readLatestCachedCardCatalog: () =>
    Promise.resolve({
      data: new Uint8Array([1]),
      artifactSha256: "a".repeat(64),
    }),
  readCachedCardCatalog: () => Promise.resolve(undefined),
  storeCardCatalog: vi.fn(),
}))

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = []
  terminated = false
  requestId = 0
  constructor() {
    super()
    FakeWorker.instances.push(this)
  }
  postMessage(request: { id: number }) {
    this.requestId = request.id
  }
  terminate() {
    this.terminated = true
  }
  complete() {
    this.dispatchEvent(new MessageEvent("message", { data: { id: this.requestId, type: "ready" } }))
  }
}

afterEach(() => {
  resetCardCatalogLoaderForTests()
  FakeWorker.instances = []
  vi.unstubAllGlobals()
  vi.mocked(storeCardCatalog).mockClear()
})

function manifest(artifactSha256: string, compressedBytes = 3) {
  return JSON.stringify({
    format: "yugilife/card-catalog",
    schemaVersion: 2,
    source: { name: "Fixture", sha256: "c".repeat(64), recordCount: 1 },
    artworkSource: { name: "Fixture", sha256: "d".repeat(64), recordCount: 0, includedCount: 0 },
    catalog: {
      file: `catalog-${artifactSha256.slice(0, 16)}.bin`,
      encoding: "br",
      artifactSha256,
      compressedBytes,
      sha256: "e".repeat(64),
      recordCount: 1,
      uncompressedBytes: 10,
    },
    rejectedCount: 0,
  })
}

/** Serves the manifest and artifact the way the static host does. */
function publish(artifactSha256: string) {
  const fetch = vi.fn((input: URL | string) =>
    Promise.resolve(
      String(input).endsWith("manifest.json")
        ? new Response(manifest(artifactSha256))
        : new Response(new Uint8Array([1, 2, 3])),
    ),
  )
  vi.stubGlobal("fetch", fetch)
  return fetch
}

async function restored() {
  vi.stubGlobal("Worker", FakeWorker)
  const pending = restoreCardCatalog()
  await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
  FakeWorker.instances[0]!.complete()
  return (await pending)!
}

it("shares one passive restoration across simultaneous route visits", async () => {
  vi.stubGlobal("Worker", FakeWorker)
  const first = restoreCardCatalog()
  const second = restoreCardCatalog()
  expect(first).toBe(second)
  await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
  FakeWorker.instances[0]!.complete()
  expect(await first).toBe(await second)
  expect(await restoreCardCatalog()).toBe(await first)
})

it("disposes a superseded restore instead of replacing a newer catalog", async () => {
  vi.stubGlobal("Worker", FakeWorker)
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))
  const old = restoreCardCatalog()
  await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
  const replacement = retryCardCatalogLoad()
  await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2))
  FakeWorker.instances[1]!.complete()
  const current = await replacement
  FakeWorker.instances[0]!.complete()
  expect(await old).toBeUndefined()
  expect(FakeWorker.instances[0]!.terminated).toBe(true)
  expect(await restoreCardCatalog()).toBe(current)
})

it("replaces a restored catalog in the background when a newer one is published", async () => {
  const saved = await restored()
  const fetch = publish("b".repeat(64))

  const update = updateRestoredCardCatalog()
  await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2))
  // The saved copy keeps answering searches until the replacement is verified.
  expect(FakeWorker.instances[0]!.terminated).toBe(false)
  FakeWorker.instances[1]!.complete()
  const replacement = await update

  expect(replacement).toBeDefined()
  expect(replacement).not.toBe(saved)
  expect(replacement!.source).toBe("network")
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(vi.mocked(storeCardCatalog).mock.calls[0]![0].artifactSha256).toBe("b".repeat(64))
  expect(FakeWorker.instances[0]!.terminated).toBe(true)
  expect(await restoreCardCatalog()).toBe(replacement)
})

it("keeps a current restored catalog and checks it only once", async () => {
  const saved = await restored()
  const fetch = publish("a".repeat(64))

  expect(await updateRestoredCardCatalog()).toBeUndefined()
  expect(await updateRestoredCardCatalog()).toBeUndefined()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(FakeWorker.instances).toHaveLength(1)
  expect(await restoreCardCatalog()).toBe(saved)
})

it("keeps the saved catalog when the background check fails", async () => {
  const saved = await restored()
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))

  expect(await updateRestoredCardCatalog()).toBeUndefined()
  expect(FakeWorker.instances[0]!.terminated).toBe(false)
  expect(await restoreCardCatalog()).toBe(saved)
})

it("drops a background update that an explicit load superseded", async () => {
  await restored()
  publish("b".repeat(64))

  const update = updateRestoredCardCatalog()
  await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2))
  const explicit = retryCardCatalogLoad()
  await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(3))
  FakeWorker.instances[1]!.complete()
  FakeWorker.instances[2]!.complete()

  expect(await update).toBeUndefined()
  expect(FakeWorker.instances[1]!.terminated).toBe(true)
  expect(await restoreCardCatalog()).toBe(await explicit)
})
