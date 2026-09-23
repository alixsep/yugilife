import { afterEach, describe, expect, it, vi } from "vitest"

import {
  isQuickSelectionWorkerAbortError,
  QuickSelectionWorkerClient,
} from "./quick-selection-worker-client"

import type { QuickSelectionWorkerResponse } from "./quick-selection-worker-protocol"

class FakeWorker extends EventTarget {
  static readonly instances: FakeWorker[] = []
  readonly messages: { message: unknown; transfer: readonly Transferable[] }[] = []
  terminated = false

  constructor() {
    super()
    FakeWorker.instances.push(this)
  }

  postMessage(message: unknown, transfer: Transferable[] = []) {
    this.messages.push({ message, transfer })
  }

  terminate() {
    this.terminated = true
  }

  respond(response: QuickSelectionWorkerResponse) {
    this.dispatchEvent(new MessageEvent("message", { data: response }))
  }
}

afterEach(() => {
  FakeWorker.instances.length = 0
  vi.unstubAllGlobals()
})

describe("QuickSelectionWorkerClient", () => {
  it("keeps encoded refinement pending until its pixels and PNG are both ready", async () => {
    vi.stubGlobal("Worker", FakeWorker)
    const client = new QuickSelectionWorkerClient()
    const worker = FakeWorker.instances[0]!
    const result = client.refineEncoded([])
    expect(worker.messages[0]?.message).toMatchObject({ type: "refine", encode: true })
    const blob = new Blob(["mask"])
    worker.respond({ id: 1, type: "refined", mask: Uint8Array.from([0, 255]).buffer, blob })
    await expect(result).resolves.toEqual({ mask: Uint8Array.from([0, 255]), blob })
    client.dispose()
  })

  it("transfers artwork bitmaps for worker-side pixel readback and closes unused bitmaps", async () => {
    vi.stubGlobal("Worker", FakeWorker)
    const client = new QuickSelectionWorkerClient()
    const worker = FakeWorker.instances[0]!
    const close = vi.fn()
    const bitmap = { close } as unknown as ImageBitmap
    const prepared = client.prepareBitmap(bitmap)
    expect(worker.messages[0]).toMatchObject({
      message: { id: 1, type: "prepare-bitmap", bitmap },
      transfer: [bitmap],
    })
    worker.respond({ id: 1, type: "prepared", width: 1, height: 1 })
    await prepared
    client.dispose()
    await expect(client.prepareBitmap(bitmap)).rejects.toSatisfy(isQuickSelectionWorkerAbortError)
    expect(close).toHaveBeenCalledOnce()
  })

  it("correlates prepared and refined responses without executing WASM on the caller", async () => {
    vi.stubGlobal("Worker", FakeWorker)
    const client = new QuickSelectionWorkerClient()
    const worker = FakeWorker.instances[0]!
    const pixels = new Uint8ClampedArray([255, 0, 0, 255])

    const prepared = client.prepare(pixels, 1, 1)
    expect(worker.messages).toHaveLength(1)
    expect(worker.messages[0]?.message).toMatchObject({
      height: 1,
      id: 1,
      type: "prepare",
      width: 1,
    })
    expect(worker.messages[0]?.transfer).toHaveLength(1)

    worker.respond({ height: 1, id: 1, type: "prepared", width: 1 })
    await expect(prepared).resolves.toBeUndefined()

    const refined = client.refine([{ id: 1, polarity: "keep", size: 12, x: 0, y: 0 }])
    expect(worker.messages[1]?.message).toMatchObject({ id: 2, type: "refine" })
    worker.respond({ id: 2, mask: Uint8Array.from([255]).buffer, type: "refined" })
    await expect(refined).resolves.toEqual(Uint8Array.from([255]))
  })

  it("keeps only the newest refinement that has not entered the worker", async () => {
    vi.stubGlobal("Worker", FakeWorker)
    const client = new QuickSelectionWorkerClient()
    const worker = FakeWorker.instances[0]!
    const first = client.refine([])
    const superseded = client.refine([{ id: 1, polarity: "keep", size: 8, x: 1, y: 1 }])
    const latest = client.refine([{ id: 2, polarity: "remove", size: 8, x: 2, y: 2 }])

    await expect(superseded).rejects.toSatisfy(isQuickSelectionWorkerAbortError)
    expect(worker.messages).toHaveLength(1)
    worker.respond({ id: 1, mask: Uint8Array.from([1]).buffer, type: "refined" })
    expect(worker.messages[1]?.message).toMatchObject({ id: 2, type: "refine" })
    worker.respond({ id: 2, mask: Uint8Array.from([2]).buffer, type: "refined" })

    await expect(first).resolves.toEqual(Uint8Array.from([1]))
    await expect(latest).resolves.toEqual(Uint8Array.from([2]))
  })

  it("terminates the worker and rejects outstanding work when disposed", async () => {
    vi.stubGlobal("Worker", FakeWorker)
    const client = new QuickSelectionWorkerClient()
    const worker = FakeWorker.instances[0]!
    const pending = client.refine([])

    client.dispose()

    expect(worker.terminated).toBe(true)
    await expect(pending).rejects.toSatisfy(isQuickSelectionWorkerAbortError)
  })

  it("rejects the request when posting to the worker fails synchronously", async () => {
    vi.stubGlobal("Worker", FakeWorker)
    const client = new QuickSelectionWorkerClient()
    const worker = FakeWorker.instances[0]!
    worker.postMessage = () => {
      throw new Error("post failed")
    }

    await expect(client.refine([])).rejects.toThrow("post failed")
    expect(worker.terminated).toBe(true)
  })
})
