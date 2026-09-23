import { ArtworkMaskWorkerClient } from "./artwork-mask-worker-client"

import type { ArtworkMaskFrame } from "./artwork-mask-worker-protocol"
import type { ArtworkMaskEffects } from "./quick-selection-types"

export type ArtworkMaskChannel = "alpha" | "luminance"
export type ProcessedArtworkMaskPixels = ArtworkMaskFrame

let worker: ArtworkMaskWorkerClient | undefined
// Durable operations are FIFO and never supersede one another. Only one owns native buffers at
// a time, even if export and inventory recovery overlap with the live editor.
let operationQueue: Promise<void> = Promise.resolve()

export function hasArtworkMaskEffects(effects: ArtworkMaskEffects | undefined) {
  return effects?.antiAlias === true || (effects?.glow ?? 0) > 0
}

export function disposeArtworkMaskWorker() {
  worker?.dispose()
  worker = undefined
}

/** The worker owns decoding, normalization, WASM processing, encoding, and preview resampling. */
export async function processArtworkMaskSource(
  source: Blob,
  effects: ArtworkMaskEffects,
  channel: ArtworkMaskChannel = "luminance",
  signal?: AbortSignal,
): Promise<ArtworkMaskFrame> {
  if (worker?.failed) worker = undefined
  worker ??= new ArtworkMaskWorkerClient()
  return worker.process(source, channel, effects, signal)
}

export async function processArtworkMaskBlob(
  source: Blob,
  effects: ArtworkMaskEffects | undefined,
  channel: ArtworkMaskChannel = "luminance",
  signal?: AbortSignal,
) {
  if (!hasArtworkMaskEffects(effects)) return source
  // Save/export/recovery are independent operations, not replaceable preview intent. Give each
  // operation ownership of its worker so preview coalescing and route cleanup cannot cancel it.
  const result = operationQueue.then(async () => {
    const operation = new ArtworkMaskWorkerClient()
    try {
      return (await operation.process(source, channel, effects!, signal)).blob
    } finally {
      operation.dispose()
    }
  })
  operationQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}
