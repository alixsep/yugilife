import { afterEach, expect, it, vi } from "vitest"

import {
  resetCardCatalogLoaderForTests,
  restoreCardCatalog,
  retryCardCatalogLoad,
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
})

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
