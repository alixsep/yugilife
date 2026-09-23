import {
  getCardCatalogStorageMode,
  readCachedCardCatalog,
  readLatestCachedCardCatalog,
  storeCardCatalog,
} from "../persistence/card-catalog-storage"

import type { CachedCardCatalog } from "../persistence/card-catalog-storage"
import type { CardCatalogEntry } from "./card-catalog"
import type {
  CardCatalogWorkerCommand,
  CardCatalogWorkerProgress,
  CardCatalogWorkerResponse,
} from "./card-catalog-worker-protocol"

const manifestFormat = "yugilife/card-catalog"
const manifestSchemaVersion = 2
const maximumManifestBytes = 32 * 1024
const maximumCompressedBytes = 2 * 1024 * 1024
const maximumCatalogBytes = 8 * 1024 * 1024
const requestTimeoutMs = 30_000

interface CardCatalogManifest {
  artworkSource: {
    includedCount: number
    name: string
    recordCount: number
    sha256: string
  }
  catalog: {
    artifactSha256: string
    compressedBytes: number
    encoding: "br"
    file: string
    recordCount: number
    sha256: string
    uncompressedBytes: number
  }
  format: typeof manifestFormat
  rejectedCount: number
  schemaVersion: typeof manifestSchemaVersion
  source: {
    name: string
    recordCount: number
    sha256: string
  }
}

export type CardCatalogLoadProgress =
  | { phase: "checking" }
  | { loadedBytes: number; phase: "downloading"; totalBytes: number }
  | CardCatalogWorkerProgress

export interface CardCatalogSearchClient {
  dispose: () => void
  search: (query: string, limit?: number) => Promise<readonly CardCatalogEntry[]>
}

export interface LoadedCardCatalog {
  search: CardCatalogSearchClient
  source: "cache" | "network" | "offline-cache"
  warning?: string
}

type ProgressCallback = (progress: CardCatalogLoadProgress) => void

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  )
}

function validCount(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function parseManifest(source: string): CardCatalogManifest {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new Error("The card catalog manifest is not valid JSON.")
  }
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "format",
      "schemaVersion",
      "source",
      "artworkSource",
      "catalog",
      "rejectedCount",
    ]) ||
    value.format !== manifestFormat ||
    value.schemaVersion !== manifestSchemaVersion ||
    !validCount(value.rejectedCount) ||
    !isRecord(value.source) ||
    !exactKeys(value.source, ["name", "sha256", "recordCount"]) ||
    typeof value.source.name !== "string" ||
    !/^[a-f0-9]{64}$/.test(String(value.source.sha256)) ||
    !validCount(value.source.recordCount) ||
    !isRecord(value.artworkSource) ||
    !exactKeys(value.artworkSource, ["name", "sha256", "recordCount", "includedCount"]) ||
    typeof value.artworkSource.name !== "string" ||
    !/^[a-f0-9]{64}$/.test(String(value.artworkSource.sha256)) ||
    !validCount(value.artworkSource.recordCount) ||
    !validCount(value.artworkSource.includedCount) ||
    Number(value.artworkSource.includedCount) > Number(value.artworkSource.recordCount) ||
    !isRecord(value.catalog) ||
    !exactKeys(value.catalog, [
      "file",
      "encoding",
      "artifactSha256",
      "compressedBytes",
      "sha256",
      "recordCount",
      "uncompressedBytes",
    ]) ||
    !/^catalog-[a-f0-9]{16}\.bin$/.test(String(value.catalog.file)) ||
    value.catalog.encoding !== "br" ||
    !/^[a-f0-9]{64}$/.test(String(value.catalog.artifactSha256)) ||
    !validCount(value.catalog.compressedBytes) ||
    Number(value.catalog.compressedBytes) > maximumCompressedBytes ||
    !/^[a-f0-9]{64}$/.test(String(value.catalog.sha256)) ||
    !validCount(value.catalog.recordCount) ||
    !validCount(value.catalog.uncompressedBytes) ||
    Number(value.catalog.uncompressedBytes) > maximumCatalogBytes ||
    Number(value.source.recordCount) !==
      Number(value.catalog.recordCount) + Number(value.rejectedCount) ||
    !String(value.catalog.file).includes(String(value.catalog.artifactSha256).slice(0, 16))
  ) {
    throw new Error("The card catalog manifest has an unsupported or malformed schema.")
  }
  return value as unknown as CardCatalogManifest
}

class CardCatalogWorkerClient implements CardCatalogSearchClient {
  private nextRequestId = 0
  private readonly pending = new Map<
    number,
    {
      onProgress: ProgressCallback | undefined
      reject: (reason: Error) => void
      resolve: (value: readonly CardCatalogEntry[] | undefined) => void
    }
  >()
  private failure: Error | undefined
  private readonly worker = new Worker(new URL("./card-catalog-worker.ts", import.meta.url), {
    type: "module",
  })

  constructor() {
    this.worker.addEventListener("message", (event: MessageEvent<CardCatalogWorkerResponse>) => {
      const response = event.data
      const pending = this.pending.get(response.id)
      if (!pending) return
      if (response.type === "progress") {
        pending.onProgress?.(response.progress)
        return
      }
      this.pending.delete(response.id)
      if (response.type === "error") pending.reject(new Error(response.message))
      else pending.resolve(response.type === "results" ? response.entries : undefined)
    })
    this.worker.addEventListener("error", () => {
      this.fail(new Error("The card catalog worker stopped unexpectedly."))
    })
    this.worker.addEventListener("messageerror", () => {
      this.fail(new Error("The card catalog worker returned unreadable data."))
    })
  }

  private rejectPending(error: Error) {
    this.pending.forEach(({ reject }) => reject(error))
    this.pending.clear()
  }

  private fail(error: Error) {
    this.failure = error
    this.worker.terminate()
    this.rejectPending(error)
  }

  private request(
    request: CardCatalogWorkerCommand,
    onProgress?: ProgressCallback,
    transfer?: Transferable[],
  ) {
    if (this.failure) return Promise.reject(this.failure)
    const id = ++this.nextRequestId
    return new Promise<readonly CardCatalogEntry[] | undefined>((resolve, reject) => {
      this.pending.set(id, { onProgress, reject, resolve })
      this.worker.postMessage({ ...request, id }, transfer ?? [])
    })
  }

  async load(record: Omit<CachedCardCatalog, "storedAt">, onProgress?: ProgressCallback) {
    const data = Uint8Array.from(record.data)
    await this.request({ record: { ...record, data }, type: "load" }, onProgress, [data.buffer])
  }

  async search(query: string, limit = 30) {
    return (await this.request({ limit, query, type: "search" })) ?? []
  }

  dispose() {
    if (!this.failure) this.fail(new Error("The card catalog worker was closed."))
  }
}

async function verifiedCatalog(
  record: Omit<CachedCardCatalog, "storedAt">,
  onProgress?: ProgressCallback,
) {
  const search = new CardCatalogWorkerClient()
  try {
    await search.load(record, onProgress)
    return { search }
  } catch (error) {
    search.dispose()
    throw error
  }
}

function requestController() {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), requestTimeoutMs)
  return { controller, dispose: () => window.clearTimeout(timeout) }
}

function responseContentLength(response: Response) {
  const header = response.headers.get("content-length")
  if (header === null) return undefined
  if (!/^\d+$/.test(header)) throw new Error("The server returned an invalid content length.")
  const value = Number(header)
  if (!Number.isSafeInteger(value)) {
    throw new Error("The server returned an invalid content length.")
  }
  return value
}

async function fetchManifest(url: URL) {
  const request = requestController()
  try {
    const response = await fetch(url, { cache: "no-cache", signal: request.controller.signal })
    if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}.`)
    const declaredLength = responseContentLength(response)
    if (declaredLength !== undefined && declaredLength > maximumManifestBytes) {
      throw new Error("The card catalog manifest exceeds the supported size limit.")
    }
    const source = await response.text()
    if (new TextEncoder().encode(source).byteLength > maximumManifestBytes) {
      throw new Error("The card catalog manifest exceeds the supported size limit.")
    }
    return parseManifest(source)
  } finally {
    request.dispose()
  }
}

async function fetchArtifact(url: URL, expectedBytes: number, onProgress?: ProgressCallback) {
  const request = requestController()
  try {
    const response = await fetch(url, { cache: "force-cache", signal: request.controller.signal })
    if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}.`)
    const declaredLength = responseContentLength(response)
    const contentEncoding = response.headers.get("content-encoding")
    if (declaredLength !== undefined && declaredLength > maximumCompressedBytes) {
      throw new Error("The card catalog download exceeds the supported size limit.")
    }
    if (
      declaredLength !== undefined &&
      (contentEncoding === null || contentEncoding === "identity") &&
      declaredLength !== expectedBytes
    ) {
      throw new Error("The card catalog download size does not match its manifest.")
    }
    if (!response.body) {
      const bytes = new Uint8Array(await response.arrayBuffer())
      onProgress?.({
        loadedBytes: bytes.byteLength,
        phase: "downloading",
        totalBytes: expectedBytes,
      })
      return bytes
    }

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let loadedBytes = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      loadedBytes += value.byteLength
      if (loadedBytes > maximumCompressedBytes || loadedBytes > expectedBytes) {
        await reader.cancel()
        throw new Error("The card catalog download exceeds its declared size.")
      }
      chunks.push(value)
      onProgress?.({ loadedBytes, phase: "downloading", totalBytes: expectedBytes })
    }
    if (loadedBytes !== expectedBytes) {
      throw new Error("The card catalog download ended before its declared size.")
    }
    const result = new Uint8Array(loadedBytes)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.byteLength
    }
    return result
  } finally {
    request.dispose()
  }
}

function catalogBaseUrl() {
  return new URL(`${import.meta.env.BASE_URL}card-catalog/`, window.location.origin)
}

function recordFromManifest(manifest: CardCatalogManifest, data: Uint8Array) {
  return {
    artifactSha256: manifest.catalog.artifactSha256,
    catalogSha256: manifest.catalog.sha256,
    compressedBytes: manifest.catalog.compressedBytes,
    data,
    recordCount: manifest.catalog.recordCount,
    uncompressedBytes: manifest.catalog.uncompressedBytes,
  }
}

function storageWarning() {
  return getCardCatalogStorageMode() === "memory"
    ? "The catalog is available for this session, but browser storage is unavailable."
    : undefined
}

function withStorageWarning(value: Omit<LoadedCardCatalog, "warning">): LoadedCardCatalog {
  const warning = storageWarning()
  return { ...value, ...(warning ? { warning } : {}) }
}

async function offlineFallback(
  reason: unknown,
  onProgress?: ProgressCallback,
): Promise<LoadedCardCatalog> {
  const latest = await readLatestCachedCardCatalog()
  if (!latest) {
    const detail = reason instanceof Error ? reason.message : "The request failed."
    throw new Error(`Unable to load the card catalog. ${detail}`)
  }
  let decoded
  try {
    decoded = await verifiedCatalog(latest, onProgress)
  } catch {
    const detail = reason instanceof Error ? reason.message : "The request failed."
    throw new Error(`Unable to load the card catalog. ${detail} The saved copy is invalid.`)
  }
  return {
    ...decoded,
    source: "offline-cache",
    warning: "Could not check for catalog updates. Using the last verified saved version.",
  }
}

async function load(onProgress?: ProgressCallback): Promise<LoadedCardCatalog> {
  onProgress?.({ phase: "checking" })
  const baseUrl = catalogBaseUrl()
  let manifest: CardCatalogManifest
  try {
    manifest = await fetchManifest(new URL("manifest.json", baseUrl))
  } catch (error) {
    return offlineFallback(error, onProgress)
  }

  const cached = await readCachedCardCatalog(manifest.catalog.artifactSha256)
  if (cached) {
    try {
      const decoded = await verifiedCatalog(cached, onProgress)
      return withStorageWarning({ ...decoded, source: "cache" })
    } catch {
      // A malformed cache is never exposed. The immutable network artifact is the repair path.
    }
  }

  try {
    const data = await fetchArtifact(
      new URL(manifest.catalog.file, baseUrl),
      manifest.catalog.compressedBytes,
      onProgress,
    )
    const record = recordFromManifest(manifest, data)
    const decoded = await verifiedCatalog(record, onProgress)
    await storeCardCatalog(record)
    return withStorageWarning({ ...decoded, source: "network" })
  } catch (error) {
    return offlineFallback(error, onProgress)
  }
}

let activeLoad: Promise<LoadedCardCatalog> | undefined
let loaded: LoadedCardCatalog | undefined
let loadGeneration = 0

let activeRestore: Promise<LoadedCardCatalog | undefined> | undefined
let activeUpdate: Promise<LoadedCardCatalog | undefined> | undefined
/** The saved artifact a passively restored catalog was read from, so an update can compare it. */
const restoredArtifacts = new WeakMap<LoadedCardCatalog, string>()
/** The restored catalog most recently confirmed to match the published manifest. */
let confirmedCurrent: LoadedCardCatalog | undefined

export function restoreCardCatalog(): Promise<LoadedCardCatalog | undefined> {
  if (loaded) return Promise.resolve(loaded)
  if (activeLoad) return activeLoad
  if (activeRestore) return activeRestore
  const generation = loadGeneration
  const pending = (async () => {
    const cached = await readLatestCachedCardCatalog()
    if (!cached || generation !== loadGeneration) return undefined
    try {
      const decoded = await verifiedCatalog(cached)
      if (generation !== loadGeneration) {
        decoded.search.dispose()
        return undefined
      }
      const restored = withStorageWarning({ ...decoded, source: "cache" })
      restoredArtifacts.set(restored, cached.artifactSha256)
      loaded = restored
      return restored
    } catch {
      return undefined
    }
  })().finally(() => {
    if (activeRestore === pending) activeRestore = undefined
  })
  activeRestore = pending
  return pending
}

/**
 * Brings a passively restored catalog up to the published version without any user action.
 *
 * Restoring reads only the saved copy, so on its own it would keep a browser on whatever catalog it
 * first downloaded for as long as that copy stays valid, however many corrected releases follow.
 * This checks the small revalidated manifest once the saved copy is searchable and, when a
 * different catalog is published, downloads and verifies it in a fresh worker while the old one
 * keeps answering searches. Only a verified and saved replacement is swapped in. Any failure keeps
 * the verified saved copy and is retried on a later visit; it never surfaces as an editor error.
 *
 * Resolves to the replacement, or to `undefined` when the saved copy is already current, nothing
 * restored is loaded, a failure occurred, or an explicit load superseded the update.
 */
export function updateRestoredCardCatalog(): Promise<LoadedCardCatalog | undefined> {
  const current = loaded
  const currentArtifact = current ? restoredArtifacts.get(current) : undefined
  if (!current || currentArtifact === undefined || confirmedCurrent === current) {
    return Promise.resolve(undefined)
  }
  if (activeUpdate) return activeUpdate
  const generation = loadGeneration
  const superseded = () => generation !== loadGeneration || loaded !== current
  const pending = (async () => {
    const baseUrl = catalogBaseUrl()
    const manifest = await fetchManifest(new URL("manifest.json", baseUrl))
    if (superseded()) return undefined
    if (manifest.catalog.artifactSha256 === currentArtifact) {
      confirmedCurrent = current
      return undefined
    }
    const data = await fetchArtifact(
      new URL(manifest.catalog.file, baseUrl),
      manifest.catalog.compressedBytes,
    )
    if (superseded()) return undefined
    const record = recordFromManifest(manifest, data)
    const decoded = await verifiedCatalog(record)
    if (superseded()) {
      decoded.search.dispose()
      return undefined
    }
    try {
      await storeCardCatalog(record)
    } catch (error) {
      decoded.search.dispose()
      throw error
    }
    if (superseded()) {
      decoded.search.dispose()
      return undefined
    }
    const replacement = withStorageWarning({ ...decoded, source: "network" })
    loaded = replacement
    // Searches still running on the old worker are discarded by their callers once the new client
    // is published, so closing it here cannot leave a stale result on screen.
    current.search.dispose()
    return replacement
  })()
    .catch(() => undefined)
    .finally(() => {
      if (activeUpdate === pending) activeUpdate = undefined
    })
  activeUpdate = pending
  return pending
}

export function loadCardCatalog(onProgress?: ProgressCallback): Promise<LoadedCardCatalog> {
  if (loaded) return Promise.resolve(loaded)
  if (activeLoad) return activeLoad
  if (activeRestore) return activeRestore.then(() => loadCardCatalog(onProgress))
  const generation = loadGeneration
  const pending = load(onProgress)
    .then((result) => {
      if (generation === loadGeneration) loaded = result
      else result.search.dispose()
      return result
    })
    .finally(() => {
      if (activeLoad === pending) activeLoad = undefined
    })
  activeLoad = pending
  return pending
}

export function retryCardCatalogLoad(onProgress?: ProgressCallback) {
  loadGeneration += 1
  loaded?.search.dispose()
  loaded = undefined
  activeLoad = undefined
  activeRestore = undefined
  activeUpdate = undefined
  return loadCardCatalog(onProgress)
}

export function resetCardCatalogLoaderForTests() {
  loadGeneration += 1
  loaded?.search.dispose()
  loaded = undefined
  activeLoad = undefined
  activeRestore = undefined
  activeUpdate = undefined
  confirmedCurrent = undefined
}
