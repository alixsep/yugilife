// Turns yugilife-core asset sources into the bytes the WebAssembly core decodes itself.

import type { AssetSource } from "../contracts/index.js"

export interface AssetBytes {
  readonly bytes: ArrayBuffer
  readonly mediaType: string | undefined
}

async function blobBytes(blob: Blob): Promise<AssetBytes> {
  return { bytes: await blob.arrayBuffer(), mediaType: blob.type || undefined }
}

async function fetchBytes(url: string, label: string, signal?: AbortSignal) {
  const response = await fetch(url, signal ? { signal } : undefined)
  if (!response.ok) throw new Error(`Could not load asset "${label}": HTTP ${response.status}.`)
  return await blobBytes(await response.blob())
}

/** Draws a decoded image source and encodes it losslessly. */
async function drawnBytes(source: CanvasImageSource, width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext("2d")
  if (!context) throw new Error("A 2D canvas context is required to read a drawable asset.")
  context.drawImage(source, 0, 0)
  return await blobBytes(await canvas.convertToBlob({ type: "image/png" }))
}

export async function assetBytes(source: AssetSource, label: string, signal?: AbortSignal) {
  if (source instanceof Blob) return await blobBytes(source)
  if (typeof source === "string") return await fetchBytes(source, label, signal)
  if (source instanceof URL) return await fetchBytes(source.href, label, signal)
  // The encoded original decodes exactly as the native renderer would; redrawing would not.
  if (source instanceof HTMLImageElement && (source.currentSrc || source.src)) {
    return await fetchBytes(source.currentSrc || source.src, label, signal)
  }
  if (source instanceof HTMLImageElement) {
    return await drawnBytes(source, source.naturalWidth, source.naturalHeight)
  }
  return await drawnBytes(source, source.width, source.height)
}

const objectReferences = new WeakMap<object, string>()
const stringReferences = new Map<string, string>()
const MAX_STRING_REFERENCES = 256
let nextReference = 1

/**
 * A name that stays the same while the host passes the same source, so the core can keep its
 * decoded image from one render to the next.
 */
export function assetReference(source: AssetSource) {
  if (typeof source === "string") {
    let reference = stringReferences.get(source)
    if (reference === undefined) {
      reference = `asset:${nextReference++}`
      if (stringReferences.size >= MAX_STRING_REFERENCES) {
        const oldest = stringReferences.keys().next().value
        if (oldest !== undefined) stringReferences.delete(oldest)
      }
    } else {
      stringReferences.delete(source)
    }
    stringReferences.set(source, reference)
    return reference
  }
  let reference = objectReferences.get(source)
  if (reference === undefined) {
    reference = `asset:${nextReference++}`
    objectReferences.set(source, reference)
  }
  return reference
}
