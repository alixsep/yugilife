import { afterEach, describe, expect, it, vi } from "vitest"

import {
  getCardCatalogStorageMode,
  readCachedCardCatalog,
  readLatestCachedCardCatalog,
  resetCardCatalogStorageForTests,
  storeCardCatalog,
} from "./card-catalog-storage"

function catalogRecord(seed: string, data: readonly number[]) {
  return {
    artifactSha256: seed.repeat(64),
    catalogSha256: "c".repeat(64),
    compressedBytes: data.length,
    data: Uint8Array.from(data),
    recordCount: 1,
    uncompressedBytes: 32,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetCardCatalogStorageForTests()
})

describe("card catalog storage", () => {
  it("keeps the exact compressed artifact available when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined)
    resetCardCatalogStorageForTests()
    const record = catalogRecord("a", [1, 2, 3])

    await storeCardCatalog(record)

    expect(getCardCatalogStorageMode()).toBe("memory")
    const cached = await readCachedCardCatalog(record.artifactSha256)
    const latest = await readLatestCachedCardCatalog()
    expect(cached).toMatchObject(record)
    expect(typeof cached?.storedAt).toBe("number")
    expect(latest).toMatchObject(record)
    expect(typeof latest?.storedAt).toBe("number")
  })

  it("atomically retains only the newest in-memory version", async () => {
    vi.stubGlobal("indexedDB", undefined)
    resetCardCatalogStorageForTests()
    const oldRecord = catalogRecord("a", [1])
    const newRecord = catalogRecord("b", [2])

    await storeCardCatalog(oldRecord)
    await storeCardCatalog(newRecord)

    await expect(readCachedCardCatalog(oldRecord.artifactSha256)).resolves.toBeUndefined()
    await expect(readCachedCardCatalog(newRecord.artifactSha256)).resolves.toMatchObject(newRecord)
  })

  it("rejects metadata that does not match the compressed bytes", async () => {
    vi.stubGlobal("indexedDB", undefined)
    resetCardCatalogStorageForTests()
    const record = catalogRecord("a", [1, 2, 3])

    await expect(storeCardCatalog({ ...record, compressedBytes: 2 })).rejects.toThrow(
      /invalid card catalog/,
    )
    await expect(readLatestCachedCardCatalog()).resolves.toBeUndefined()
  })
})
