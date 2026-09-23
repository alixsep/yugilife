import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { createServer } from "node:http"

import { chromium } from "@playwright/test"

const assets = new URL("../dist/assets/", import.meta.url)
const measureTimings = !process.argv.includes("--verify-only")
const files = await readdir(assets)
const workerFile = files.find((name) => /^artwork-mask-worker-[^.]+\.js$/.test(name))
assert(workerFile, "Built effects worker must exist")
const selectionWorkerFile = files.find((name) => /^quick-selection-worker-[^.]+\.js$/.test(name))
assert(selectionWorkerFile, "Built selection worker must exist")
const server = createServer(async (request, response) => {
  const name = request.url.split("/").at(-1)
  if (!files.includes(name)) {
    response.setHeader("Content-Type", "text/html")
    response.end("<!doctype html><title>Mask worker check</title>")
    return
  }
  response.setHeader(
    "Content-Type",
    name.endsWith(".wasm") ? "application/wasm" : "application/javascript",
  )
  response.end(await readFile(new URL(name, assets)))
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
let browser
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  const result = await page.evaluate(
    async ({ workerFile, selectionWorkerFile, measureTimings }) => {
      const worker = new Worker(`/${workerFile}`, { type: "module" })
      let id = 0
      const process = (source, effects, sourceId = 1) =>
        new Promise((resolve, reject) => {
          worker.onmessage = ({ data }) =>
            data.error ? reject(new Error(data.error)) : resolve(data.frame)
          worker.onerror = (event) => reject(new Error(event.message))
          worker.postMessage({ id: ++id, sourceId, source, channel: "alpha", effects })
        })
      const canvas = new OffscreenCanvas(3072, 4096)
      const ctx = canvas.getContext("2d")
      ctx.fillStyle = "white"
      ctx.fillRect(1024, 1024, 1024, 2048)
      const source = await canvas.convertToBlob()
      let ticks = 0
      const timer = setInterval(() => ticks++, 10)
      const times = []
      let frame
      for (const effects of [{ glow: 16 }, { glow: 32, antiAlias: true }, { glow: 8 }]) {
        const start = measureTimings ? performance.now() : 0
        frame = await process(source, effects)
        if (measureTimings) times.push(Math.round(performance.now() - start))
      }
      clearInterval(timer)
      const bitmap = await createImageBitmap(frame.blob)
      const decoded = new OffscreenCanvas(bitmap.width, bitmap.height)
      const decodedContext = decoded.getContext("2d")
      decodedContext.drawImage(bitmap, 0, 0)
      const alphas = [1023, 1018, 1000].map(
        (x) => decodedContext.getImageData(x, 2000, 1, 1).data[3],
      )
      const dimensions = [bitmap.width, bitmap.height]
      bitmap.close()
      const small = new OffscreenCanvas(8, 8)
      const smallContext = small.getContext("2d")
      smallContext.fillStyle = "white"
      smallContext.fillRect(4, 0, 4, 8)
      const smallSource = await small.convertToBlob()
      const hard = await process(smallSource, {}, 2)
      const smooth = await process(smallSource, { antiAlias: true }, 2)
      const edgeOffset = (3 * 8 + 3) * 4 + 3
      const antiAlias = [hard.pixels[edgeOffset], smooth.pixels[edgeOffset]]
      worker.terminate()
      const selectionWorker = new Worker(`/${selectionWorkerFile}`, { type: "module" })
      const selectionRequest = (message, transfer = []) =>
        new Promise((resolve, reject) => {
          selectionWorker.onmessage = ({ data }) =>
            data.type === "error" ? reject(new Error(data.message)) : resolve(data)
          selectionWorker.onerror = (event) => reject(new Error(event.message))
          selectionWorker.postMessage(message, transfer)
        })
      const artworkBitmap = await createImageBitmap(source)
      await selectionRequest({ id: 1, type: "prepare-bitmap", bitmap: artworkBitmap }, [
        artworkBitmap,
      ])
      const emptySelection = await selectionRequest({ id: 2, type: "refine", points: [] })
      const emptyPixels = new Uint8Array(emptySelection.mask)
      const selection = {
        size: emptyPixels.length,
        empty: emptyPixels.every((value) => value === 0),
      }
      const points = [
        { id: 1, polarity: "keep", size: 64, x: 1500, y: 2000 },
        { id: 2, polarity: "remove", size: 64, x: 100, y: 100 },
      ]
      const raw = await selectionRequest({ id: 3, type: "refine", points })
      const encodeStart = measureTimings ? performance.now() : 0
      const encoded = await selectionRequest({ id: 4, type: "refine", points, encode: true })
      const encodedTime = measureTimings ? Math.round(performance.now() - encodeStart) : undefined
      const rawPixels = new Uint8Array(raw.mask)
      const encodedPixels = new Uint8Array(encoded.mask)
      const unchangedSelection = rawPixels.every((value, index) => value === encodedPixels[index])
      const pinBitmap = await createImageBitmap(encoded.blob)
      const pinCanvas = new OffscreenCanvas(pinBitmap.width, pinBitmap.height)
      const pinContext = pinCanvas.getContext("2d")
      pinContext.drawImage(pinBitmap, 0, 0)
      const pinImage = pinContext.getImageData(0, 0, pinBitmap.width, pinBitmap.height).data
      const faithfulPng = encodedPixels.every((value, index) => {
        const offset = index * 4
        return (
          pinImage[offset] === value &&
          pinImage[offset + 1] === value &&
          pinImage[offset + 2] === value &&
          pinImage[offset + 3] === 255
        )
      })
      pinBitmap.close()
      selectionWorker.terminate()
      return {
        times,
        ticks,
        dimensions,
        preview: [frame.width, frame.height],
        previewBytes: frame.pixels.byteLength,
        alphas,
        antiAlias,
        selection,
        encodedTime,
        unchangedSelection,
        faithfulPng,
      }
    },
    { workerFile, selectionWorkerFile, measureTimings },
  )
  assert.deepEqual(result.dimensions, [3072, 4096])
  assert.deepEqual(result.preview, [768, 1024])
  assert(result.alphas[0] > result.alphas[1] && result.alphas[1] > result.alphas[2])
  assert.equal(result.alphas[2], 0)
  assert.equal(result.antiAlias[0], 0)
  assert(result.antiAlias[1] > 0 && result.antiAlias[1] < 255)
  assert.deepEqual(result.selection, { size: 3072 * 4096, empty: true })
  assert(result.unchangedSelection, "Encoding must not change the refined mask")
  assert(result.faithfulPng, "Every PNG pixel must preserve the opaque grayscale mask format")
  assert(result.ticks > 0, "UI event loop must keep running during processing")
  console.log(
    measureTimings ? JSON.stringify(result) : "Mask worker pixel and responsiveness checks passed.",
  )
} finally {
  await browser?.close()
  await new Promise((resolve) => server.close(resolve))
}
