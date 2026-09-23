import { QuickSelectionWorkerAbortError } from "./quick-selection-worker-client"

import type {
  ArtworkMaskFrame,
  ArtworkMaskRequest,
  ArtworkMaskResponse,
} from "./artwork-mask-worker-protocol"

interface Job {
  request: ArtworkMaskRequest
  resolve: (frame: ArtworkMaskFrame) => void
  reject: (reason: Error) => void
}

/** At most one running job and one queued intent; no decoding or pixel allocation on the caller. */
export class ArtworkMaskWorkerClient {
  readonly #worker = new Worker(new URL("./artwork-mask-worker.ts", import.meta.url), {
    type: "module",
  })
  readonly #sources = new WeakMap<Blob, number>()
  #nextId = 0
  #sourceId = 0
  #active: Job | undefined
  #queued: Job | undefined
  #failure: Error | undefined

  constructor() {
    this.#worker.addEventListener("message", (event: MessageEvent<ArtworkMaskResponse>) => {
      const response = event.data
      const active = this.#active
      if (!active || response.id !== active.request.id) return
      this.#active = undefined
      if ("error" in response) active.reject(new Error(response.error))
      else active.resolve(response.frame)
      this.#flush()
    })
    this.#worker.addEventListener("error", () =>
      this.#fail(new Error("The artwork mask worker stopped unexpectedly.")),
    )
    this.#worker.addEventListener("messageerror", () =>
      this.#fail(new Error("The artwork mask worker returned unreadable data.")),
    )
  }

  get failed() {
    return this.#failure !== undefined
  }

  process(
    source: Blob,
    channel: ArtworkMaskRequest["channel"],
    effects: ArtworkMaskRequest["effects"],
    signal?: AbortSignal,
  ) {
    if (this.#failure) return Promise.reject(this.#failure)
    if (signal?.aborted) return Promise.reject(new QuickSelectionWorkerAbortError())
    let sourceId = this.#sources.get(source)
    if (sourceId === undefined) {
      sourceId = ++this.#sourceId
      this.#sources.set(source, sourceId)
    }
    return new Promise<ArtworkMaskFrame>((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener("abort", abort)
      const job: Job = {
        request: { id: ++this.#nextId, sourceId, source, channel, effects: { ...effects } },
        resolve: (frame) => {
          cleanup()
          resolve(frame)
        },
        reject: (reason) => {
          cleanup()
          reject(reason)
        },
      }
      const abort = () => {
        if (this.#queued === job) this.#queued = undefined
        job.reject(new QuickSelectionWorkerAbortError())
      }
      signal?.addEventListener("abort", abort, { once: true })
      this.#queued?.reject(new QuickSelectionWorkerAbortError())
      this.#queued = job
      this.#flush()
    })
  }

  dispose() {
    this.#fail(new QuickSelectionWorkerAbortError("Artwork mask worker was closed."))
  }

  #flush() {
    if (this.#active || !this.#queued || this.#failure) return
    this.#active = this.#queued
    this.#queued = undefined
    try {
      this.#worker.postMessage(this.#active.request)
    } catch (reason) {
      this.#fail(reason instanceof Error ? reason : new Error("Could not send artwork mask work."))
    }
  }

  #fail(reason: Error) {
    if (this.#failure) return
    this.#failure = reason
    this.#worker.terminate()
    this.#active?.reject(reason)
    this.#queued?.reject(reason)
    this.#active = this.#queued = undefined
  }
}
