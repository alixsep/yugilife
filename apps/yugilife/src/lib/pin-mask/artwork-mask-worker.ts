import { MaskEffects } from "./quick-selection-engine"

import type { ArtworkMaskRequest, ArtworkMaskResponse } from "./artwork-mask-worker-protocol"

// One source only: changing artwork releases the old decoded plane and WASM allocation together.
let prepared:
  | {
      sourceId: number
      channel: ArtworkMaskRequest["channel"]
      width: number
      height: number
      engine: MaskEffects
    }
  | undefined

async function process(request: ArtworkMaskRequest) {
  if (prepared?.sourceId !== request.sourceId || prepared.channel !== request.channel) {
    prepared = undefined
    const bitmap = await createImageBitmap(request.source)
    try {
      const { width, height } = bitmap
      const canvas = new OffscreenCanvas(width, height)
      const context = canvas.getContext("2d", { willReadFrequently: true })
      if (!context) throw new Error("A 2D canvas is required to decode the mask.")
      context.drawImage(bitmap, 0, 0)
      const rgba = context.getImageData(0, 0, width, height).data
      const alpha = new Uint8Array(width * height)
      for (let offset = 0; offset < rgba.length; offset += 4) {
        if (request.channel === "luminance") {
          alpha[offset / 4] = Math.round(
            ((rgba[offset]! * 0.2126 + rgba[offset + 1]! * 0.7152 + rgba[offset + 2]! * 0.0722) *
              rgba[offset + 3]!) /
              255,
          )
        } else alpha[offset / 4] = rgba[offset + 3]!
      }
      canvas.width = canvas.height = 1
      prepared = {
        sourceId: request.sourceId,
        channel: request.channel,
        width,
        height,
        engine: await MaskEffects.prepare(alpha, width, height),
      }
    } finally {
      bitmap.close()
    }
  }
  const { width, height, engine } = prepared
  const alpha = engine.process(request.effects)
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext("2d")
  if (!context) throw new Error("A 2D canvas is required to encode the mask.")
  const pixels = context.createImageData(width, height)
  pixels.data.fill(255)
  for (let index = 0; index < alpha.length; index += 1) pixels.data[index * 4 + 3] = alpha[index]!
  context.putImageData(pixels, 0, 0)
  const blob = await canvas.convertToBlob({ type: "image/png" })
  const scale = Math.min(1, 1024 / Math.max(width, height))
  const preview = new OffscreenCanvas(
    Math.max(1, Math.round(width * scale)),
    Math.max(1, Math.round(height * scale)),
  )
  const previewContext = preview.getContext("2d", { willReadFrequently: true })
  if (!previewContext) throw new Error("A 2D canvas is required to preview the mask.")
  previewContext.drawImage(canvas, 0, 0, preview.width, preview.height)
  const frame = {
    blob,
    width: preview.width,
    height: preview.height,
    pixels: previewContext.getImageData(0, 0, preview.width, preview.height).data,
  }
  canvas.width = canvas.height = 1
  return frame
}

const host = globalThis as unknown as {
  postMessage(response: ArtworkMaskResponse, transfer?: Transferable[]): void
}
let queue = Promise.resolve()
globalThis.addEventListener("message", (event: MessageEvent<ArtworkMaskRequest>) => {
  queue = queue.then(async () => {
    try {
      const frame = await process(event.data)
      host.postMessage({ id: event.data.id, frame }, [frame.pixels.buffer])
    } catch (reason) {
      host.postMessage({
        id: event.data.id,
        error: reason instanceof Error ? reason.message : "Mask processing failed.",
      })
    }
  })
})
