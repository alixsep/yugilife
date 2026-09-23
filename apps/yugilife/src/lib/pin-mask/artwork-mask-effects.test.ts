import { afterEach, describe, expect, it, vi } from "vitest"

import {
  disposeArtworkMaskWorker,
  processArtworkMaskBlob,
  processArtworkMaskSource,
} from "./artwork-mask-effects"

import type { ArtworkMaskRequest } from "./artwork-mask-worker-protocol"

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = []
  messages: ArtworkMaskRequest[] = []
  terminated = false
  constructor() {
    super()
    FakeWorker.instances.push(this)
  }
  postMessage(message: ArtworkMaskRequest) {
    this.messages.push(message)
  }
  terminate() {
    this.terminated = true
  }
  complete(blob: Blob) {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: {
          id: this.messages[0]!.id,
          frame: { blob, width: 1, height: 1, pixels: new Uint8ClampedArray(4) },
        },
      }),
    )
  }
}

afterEach(() => {
  disposeArtworkMaskWorker()
  FakeWorker.instances = []
  vi.unstubAllGlobals()
})

describe("mask operation ownership", () => {
  it("lets independent exports finish when the preview is closed", async () => {
    vi.stubGlobal("Worker", FakeWorker)
    const source = new Blob()
    const preview = processArtworkMaskSource(source, { glow: 1 })
    const first = processArtworkMaskBlob(source, { glow: 2 })
    const second = processArtworkMaskBlob(source, { glow: 3 })
    disposeArtworkMaskWorker()
    await expect(preview).rejects.toMatchObject({ name: "AbortError" })
    expect(FakeWorker.instances[1]!.terminated).toBe(false)
    expect(FakeWorker.instances).toHaveLength(2)
    const firstBlob = new Blob(["first"])
    const secondBlob = new Blob(["second"])
    FakeWorker.instances[1]!.complete(firstBlob)
    await expect(first).resolves.toBe(firstBlob)
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(3))
    FakeWorker.instances[2]!.complete(secondBlob)
    await expect(second).resolves.toBe(secondBlob)
    expect(FakeWorker.instances.every((worker) => worker.terminated)).toBe(true)
  })

  it("returns the unchanged source without creating a worker for disabled effects", async () => {
    vi.stubGlobal("Worker", FakeWorker)
    const source = new Blob()
    await expect(processArtworkMaskBlob(source, { antiAlias: false, glow: 0 })).resolves.toBe(
      source,
    )
    expect(FakeWorker.instances).toHaveLength(0)
  })
})

it("recreates a crashed preview worker on retry", async () => {
  vi.stubGlobal("Worker", FakeWorker)
  const failed = processArtworkMaskSource(new Blob(), { glow: 1 })
  FakeWorker.instances[0]!.dispatchEvent(new Event("error"))
  await expect(failed).rejects.toThrow(/stopped/)
  const retry = processArtworkMaskSource(new Blob(), { glow: 1 })
  expect(FakeWorker.instances).toHaveLength(2)
  const result = new Blob(["processed"])
  FakeWorker.instances[1]!.complete(result)
  await expect(retry).resolves.toMatchObject({ blob: result })
})
