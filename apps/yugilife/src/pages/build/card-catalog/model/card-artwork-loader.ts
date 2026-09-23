import { decodePinMaskPreset } from "@/lib/pin-mask/quick-selection"
import { decodeYlm } from "@/lib/ylm"

import type { PinMaskPoint } from "@/lib/pin-mask/quick-selection"
import type { DecodedYlm } from "@/lib/ylm"

const artworkOrigin = "https://yugilife-artworks.alixsep.workers.dev/"
const maximumArtworkBytes = 16 * 1024 * 1024
const downloadTimeoutMs = 120_000
/**
 * Progress is rate-limited by wall clock rather than by transferred bytes. A byte step ties the
 * report rate to connection speed — the same one-percent step that is calm on a slow link fires
 * dozens of times a second on a fast one — whereas a fixed interval bounds the repaint rate on
 * every connection. Both the aggregate and each individual transfer are limited, so adding
 * artworks to a batch cannot multiply the rate.
 *
 * The first and last reports of each file, and every bundle completion, bypass the limit: the bar
 * still starts at zero, lands on the true final byte count, and never stalls short of a boundary.
 */
const progressIntervalMs = 250
/** Each artwork is two separately hosted files: its image bundle and its alpha bundle. */
const bundlesPerArtwork = 2

export type CardArtworkLoadProgress =
  { loadedBytes: number; phase: "downloading"; totalBytes?: number } | { phase: "verifying" }

export interface CardArtworkIdentity {
  artworkId: number
  cardCid: number
  name: string
  passcode?: string
}

interface CardArtworkLoadOptions {
  onProgress?: (progress: CardArtworkLoadProgress) => void
  signal?: AbortSignal
}

/**
 * Aggregate progress across every bundle of every requested artwork.
 *
 * The denominator is bundles, not bytes. An artwork's alpha bundle is a second request whose size
 * is unknown until its own response headers arrive, and the worker may serve either bundle without
 * a usable `content-length` at all, so a byte denominator would grow mid-download and slide the bar
 * backwards. The bundle count is known before the first request, which is what keeps `ratio`
 * monotonic from the first frame to the last.
 */
export interface CardArtworksLoadProgress {
  /** Bytes received across every bundle so far. Informational, and never decreases. */
  loadedBytes: number
  /** Overall completion in [0, 1]: settled bundles plus the transferred fraction of live ones. */
  ratio: number
  /** True while every started bundle is being authenticated and decoded rather than transferred. */
  verifying: boolean
}

interface CardArtworksLoadOptions {
  onProgress?: (progress: CardArtworksLoadProgress) => void
  signal?: AbortSignal
}

export interface CardArtworkCollectionIdentity {
  artworkIds: readonly number[]
  cardCid: number
  name: string
  passcode?: string
}

export interface LoadedCardArtworks {
  artworks: ReadonlyMap<number, LoadedCardArtwork>
  missingArtworkIds: readonly number[]
}

export interface LoadedCardArtwork {
  alphaMask?: Blob | undefined
  image: Blob
  maskPoints?: readonly PinMaskPoint[] | undefined
}

export class ArtworkNotFoundError extends Error {
  readonly artworkId: number

  constructor(artworkId: number) {
    super(`Artwork ${artworkId} has not been uploaded yet.`)
    this.name = "ArtworkNotFoundError"
    this.artworkId = artworkId
  }
}

function contentLength(response: Response) {
  const header = response.headers.get("content-length")
  if (header === null) return undefined
  if (!/^\d+$/.test(header)) throw new Error("The artwork server returned an invalid file size.")
  const value = Number(header)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("The artwork server returned an invalid file size.")
  }
  return value
}

function abortError() {
  return new DOMException("Artwork download was cancelled.", "AbortError")
}

async function responseBytes(
  response: Response,
  onProgress?: CardArtworkLoadOptions["onProgress"],
) {
  const encodedResponse = response.headers.get("content-encoding")
  const declaredBytes = contentLength(response)
  const totalBytes = encodedResponse && encodedResponse !== "identity" ? undefined : declaredBytes
  if (declaredBytes !== undefined && declaredBytes > maximumArtworkBytes) {
    throw new Error("The artwork file exceeds the supported 16 MB size limit.")
  }

  if (!response.body) {
    const result = new Uint8Array(await response.arrayBuffer())
    if (result.byteLength > maximumArtworkBytes) {
      throw new Error("The artwork file exceeds the supported 16 MB size limit.")
    }
    if (totalBytes !== undefined && result.byteLength !== totalBytes) {
      throw new Error("The artwork download did not match its declared size.")
    }
    onProgress?.({
      loadedBytes: result.byteLength,
      phase: "downloading",
      ...(totalBytes === undefined ? {} : { totalBytes }),
    })
    return result
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loadedBytes = 0
  let reportedBytes: number | undefined
  let reportedAt = 0
  const report = (force: boolean) => {
    if (!onProgress) return
    const now = Date.now()
    if (!force && now - reportedAt < progressIntervalMs) return
    if (reportedBytes === loadedBytes) return
    reportedBytes = loadedBytes
    reportedAt = now
    onProgress({
      loadedBytes,
      phase: "downloading",
      ...(totalBytes === undefined ? {} : { totalBytes }),
    })
  }

  // Published before the first chunk so the bar starts empty against a known denominator rather
  // than appearing already part-filled at whatever the first chunk happened to carry.
  report(true)
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    loadedBytes += value.byteLength
    if (loadedBytes > maximumArtworkBytes) {
      await reader.cancel()
      throw new Error("The artwork file exceeds the supported 16 MB size limit.")
    }
    if (totalBytes !== undefined && loadedBytes > totalBytes) {
      await reader.cancel()
      throw new Error("The artwork download exceeded its declared size.")
    }
    chunks.push(value)
    report(false)
  }
  report(true)
  if (loadedBytes === 0) throw new Error("The artwork server returned an empty file.")
  if (totalBytes !== undefined && loadedBytes !== totalBytes) {
    throw new Error("The artwork download ended before its declared size.")
  }

  const result = new Uint8Array(loadedBytes)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function validateIdentity(
  decoded: DecodedYlm,
  expected: CardArtworkIdentity,
  bundleKind: DecodedYlm["bundleKind"] = "artwork",
) {
  if (decoded.bundleKind !== bundleKind) {
    throw new Error(`The downloaded YLM is not an ${bundleKind} bundle.`)
  }
  if (decoded.identity.artworkId !== String(expected.artworkId)) {
    throw new Error("The downloaded artwork ID does not match the selected artwork.")
  }
  if (decoded.identity.cardCid !== String(expected.cardCid)) {
    throw new Error("The downloaded artwork belongs to a different catalog card.")
  }
  if (decoded.identity.passcode !== (expected.passcode ?? null)) {
    throw new Error("The downloaded artwork has a different card passcode.")
  }
  if (decoded.identity.name !== expected.name) {
    throw new Error("The downloaded artwork has a different card name.")
  }
}

async function downloadArtworkBundle(
  expected: CardArtworkIdentity,
  kind: "artwork" | "alpha",
  options: CardArtworkLoadOptions,
): Promise<DecodedYlm | undefined> {
  if (
    !Number.isSafeInteger(expected.artworkId) ||
    expected.artworkId < 1 ||
    !Number.isSafeInteger(expected.cardCid) ||
    expected.cardCid < 1
  ) {
    throw new Error("The selected artwork identity is invalid.")
  }
  if (options.signal?.aborted) throw abortError()
  const controller = new AbortController()
  let timedOut = false
  const timeout = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, downloadTimeoutMs)
  const cancel = () => controller.abort()
  options.signal?.addEventListener("abort", cancel, { once: true })
  let responseReceived = false
  try {
    const suffix = kind === "alpha" ? "_alpha" : ""
    const response = await fetch(new URL(`${expected.artworkId}${suffix}.ylm`, artworkOrigin), {
      cache: "no-cache",
      credentials: "omit",
      mode: "cors",
      signal: controller.signal,
    })
    responseReceived = true
    if (response.status === 404) {
      if (kind === "alpha") return undefined
      throw new ArtworkNotFoundError(expected.artworkId)
    }
    if (!response.ok) throw new Error(`Artwork download failed with HTTP ${response.status}.`)
    const encoded = await responseBytes(response, options.onProgress)
    options.onProgress?.({ phase: "verifying" })
    const decoded = await decodeYlm(encoded.buffer)
    if (controller.signal.aborted) throw abortError()
    validateIdentity(decoded, expected, kind)
    return decoded
  } catch (error) {
    if (options.signal?.aborted) throw abortError()
    if (timedOut) throw new Error("The artwork download timed out. Please try again.")
    if (error instanceof TypeError) {
      throw new Error(
        responseReceived
          ? "The artwork download was interrupted. Please try again."
          : "Could not reach the artwork server. Check your connection and the server's CORS settings.",
      )
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
    options.signal?.removeEventListener("abort", cancel)
  }
}

export async function loadCardArtwork(
  expected: CardArtworkIdentity,
  options: CardArtworkLoadOptions = {},
): Promise<Blob> {
  const decoded = await downloadArtworkBundle(expected, "artwork", options)
  const rgb = decoded?.assets.get("rgb")
  if (!rgb?.byteLength) throw new Error("The artwork YLM does not contain an RGB image.")
  return new Blob([rgb.slice().buffer], { type: "image/avif" })
}

/** Mask-only recovery does not redownload or require the separately hosted RGB bundle. */
export async function loadCardArtworkAlpha(
  expected: CardArtworkIdentity,
  options: CardArtworkLoadOptions = {},
): Promise<Pick<LoadedCardArtwork, "alphaMask" | "maskPoints"> | undefined> {
  const decoded = await downloadArtworkBundle(expected, "alpha", options)
  if (!decoded) return undefined
  const alpha = decoded.assets.get("alpha")
  const mask = decoded.assets.get("mask")
  if (!alpha?.byteLength || !mask?.byteLength)
    throw new Error("The artwork alpha YLM is missing its alpha image or mask preset.")
  return {
    alphaMask: new Blob([alpha.slice().buffer], { type: "image/avif" }),
    maskPoints: decodePinMaskPreset(mask),
  }
}

/**
 * Folds the per-bundle reports of a batch into one monotonic aggregate.
 *
 * A bundle is *live* while its bytes are arriving and *settled* once the loader has returned it.
 * Settled bytes are moved out of the live map, so an artwork's second request cannot reset the
 * count its first request already contributed — the bug that made the old per-artwork map jump
 * back to zero halfway through.
 */
function batchProgressReporter(
  artworkIds: readonly number[],
  onProgress: NonNullable<CardArtworksLoadOptions["onProgress"]>,
) {
  const totalBundles = artworkIds.length * bundlesPerArtwork
  const live = new Map<string, { fraction: number; loadedBytes: number; verifying: boolean }>()
  let settledBundles = 0
  let settledBytes = 0

  let publishedAt = 0
  const publish = (force: boolean) => {
    const now = Date.now()
    // Concurrent artworks each report on their own clock, so the aggregate is limited again here:
    // the bar repaints at a bounded rate no matter how many bundles are in flight.
    if (!force && now - publishedAt < progressIntervalMs) return
    publishedAt = now
    let liveFraction = 0
    let liveBytes = 0
    let transferring = false
    live.forEach((state) => {
      liveFraction += state.fraction
      liveBytes += state.loadedBytes
      if (!state.verifying) transferring = true
    })
    onProgress({
      loadedBytes: settledBytes + liveBytes,
      ratio: totalBundles === 0 ? 1 : Math.min(1, (settledBundles + liveFraction) / totalBundles),
      verifying: live.size > 0 && !transferring,
    })
  }

  return function bundle(artworkId: number, kind: "alpha" | "image") {
    const key = `${artworkId}:${kind}`
    let settled = false
    return {
      progress: (report: CardArtworkLoadProgress) => {
        const previous = live.get(key)
        if (report.phase === "verifying") {
          // Every byte has arrived; the bundle is whole even though it is not yet trusted.
          live.set(key, { fraction: 1, loadedBytes: previous?.loadedBytes ?? 0, verifying: true })
        } else {
          live.set(key, {
            // Without a usable size the bundle contributes nothing until it settles, which keeps
            // the bar honest rather than inventing a denominator.
            fraction: report.totalBytes ? report.loadedBytes / report.totalBytes : 0,
            loadedBytes: report.loadedBytes,
            verifying: false,
          })
        }
        // A bundle reaching its verifying stage is a state change, not a byte tick.
        publish(report.phase === "verifying")
      },
      /** Idempotent: a missing artwork settles both of its bundles at once. */
      settle: () => {
        if (settled) return
        settled = true
        settledBytes += live.get(key)?.loadedBytes ?? 0
        settledBundles += 1
        live.delete(key)
        publish(true)
      },
    }
  }
}

export async function loadCardArtworks(
  expected: CardArtworkCollectionIdentity,
  options: CardArtworksLoadOptions = {},
): Promise<LoadedCardArtworks> {
  if (new Set(expected.artworkIds).size !== expected.artworkIds.length) {
    throw new Error("The card catalog contains duplicate artwork IDs.")
  }
  if (options.signal?.aborted) throw abortError()
  const controller = new AbortController()
  const cancel = () => controller.abort()
  options.signal?.addEventListener("abort", cancel, { once: true })
  const onProgress = options.onProgress
  const bundle = onProgress ? batchProgressReporter(expected.artworkIds, onProgress) : undefined
  try {
    const results = await Promise.all(
      expected.artworkIds.map(async (artworkId) => {
        const imageBundle = bundle?.(artworkId, "image")
        const alphaBundle = bundle?.(artworkId, "alpha")
        try {
          const identity = {
            artworkId,
            cardCid: expected.cardCid,
            name: expected.name,
            ...(expected.passcode ? { passcode: expected.passcode } : {}),
          }
          const image = await loadCardArtwork(identity, {
            ...(imageBundle ? { onProgress: imageBundle.progress } : {}),
            signal: controller.signal,
          })
          imageBundle?.settle()
          const alpha = await loadCardArtworkAlpha(identity, {
            ...(alphaBundle ? { onProgress: alphaBundle.progress } : {}),
            signal: controller.signal,
          })
          alphaBundle?.settle()
          return { artwork: { image, ...alpha }, artworkId }
        } catch (error) {
          if (error instanceof ArtworkNotFoundError) {
            // A card with no hosted artwork still finishes its share of the batch.
            imageBundle?.settle()
            alphaBundle?.settle()
            return { artworkId }
          }
          controller.abort()
          throw error
        }
      }),
    )
    return {
      artworks: new Map(
        results.flatMap(({ artwork, artworkId }) =>
          artwork === undefined ? [] : [[artworkId, artwork] as const],
        ),
      ),
      missingArtworkIds: results.flatMap(({ artwork, artworkId }) =>
        artwork === undefined ? [artworkId] : [],
      ),
    }
  } catch (error) {
    controller.abort()
    if (options.signal?.aborted) throw abortError()
    throw error
  } finally {
    options.signal?.removeEventListener("abort", cancel)
  }
}
