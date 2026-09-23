import { afterEach, describe, expect, it, vi } from "vitest"

import { ArtworkMaskWorkerClient } from "./artwork-mask-worker-client"

import type { ArtworkMaskRequest, ArtworkMaskResponse } from "./artwork-mask-worker-protocol"

class FakeWorker extends EventTarget {
  static current: FakeWorker
  messages: ArtworkMaskRequest[] = []
  terminated = false
  constructor() {
    super()
    FakeWorker.current = this
  }
  postMessage(message: ArtworkMaskRequest) {
    this.messages.push(message)
  }
  terminate() {
    this.terminated = true
  }
  respond(response: ArtworkMaskResponse) {
    this.dispatchEvent(new MessageEvent("message", { data: response }))
  }
}

afterEach(() => vi.unstubAllGlobals())

function setup() {
  vi.stubGlobal("Worker", FakeWorker)
  return { client: new ArtworkMaskWorkerClient(), worker: FakeWorker.current }
}

const frame = () => ({ blob: new Blob(), width: 1, height: 1, pixels: new Uint8ClampedArray(4) })

describe("artwork mask scheduling", () => {
  it("sends only the running and newest intent, with stable source identity and no pixel expansion", async () => {
    const { client, worker } = setup()
    const source = new Blob()
    const first = client.process(source, "alpha", { glow: 1 })
    const skipped = client.process(source, "alpha", { glow: 2 })
    const skippedAssertion = expect(skipped).rejects.toMatchObject({ name: "AbortError" })
    const last = client.process(source, "alpha", { glow: 3 })
    await skippedAssertion
    expect(worker.messages).toHaveLength(1)
    expect(worker.messages[0]?.source).toBe(source)
    worker.respond({ id: 1, frame: frame() })
    await first
    expect(worker.messages).toHaveLength(2)
    expect(worker.messages[1]).toMatchObject({
      effects: { glow: 3 },
      sourceId: worker.messages[0]!.sourceId,
    })
    worker.respond({ id: 3, frame: frame() })
    await expect(last).resolves.toMatchObject({ width: 1 })
    client.dispose()
  })

  it("removes aborted queued work before it can decode or encode a mask", async () => {
    const { client, worker } = setup()
    const running = client.process(new Blob(), "alpha", { glow: 1 })
    const abort = new AbortController()
    const queued = client.process(new Blob(), "alpha", { glow: 2 }, abort.signal)
    abort.abort()
    await expect(queued).rejects.toMatchObject({ name: "AbortError" })
    worker.respond({ id: 1, frame: frame() })
    await running
    expect(worker.messages).toHaveLength(1)
    client.dispose()
  })

  it("rejects an aborted running consumer immediately but keeps worker serialization", async () => {
    const { client, worker } = setup()
    const abort = new AbortController()
    const running = client.process(new Blob(), "alpha", { glow: 1 }, abort.signal)
    abort.abort()
    await expect(running).rejects.toMatchObject({ name: "AbortError" })
    const next = client.process(new Blob(), "luminance", { glow: 2 })
    expect(worker.messages).toHaveLength(1)
    worker.respond({ id: 1, frame: frame() })
    expect(worker.messages).toHaveLength(2)
    worker.respond({ id: 2, frame: frame() })
    await next
    client.dispose()
  })

  it("settles outstanding consumers and terminates on a worker error", async () => {
    const { client, worker } = setup()
    const running = client.process(new Blob(), "alpha", { glow: 1 })
    const queued = client.process(new Blob(), "alpha", { glow: 2 })
    worker.dispatchEvent(new Event("error"))
    await expect(running).rejects.toThrow("stopped unexpectedly")
    await expect(queued).rejects.toThrow("stopped unexpectedly")
    expect(worker.terminated).toBe(true)
    await expect(client.process(new Blob(), "alpha", {})).rejects.toThrow("stopped unexpectedly")
  })
})
