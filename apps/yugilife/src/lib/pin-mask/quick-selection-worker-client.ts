import type { PinMaskPoint } from "./quick-selection-types"
import type {
  QuickSelectionWorkerRequest,
  QuickSelectionWorkerResponse,
} from "./quick-selection-worker-protocol"

type PendingRequest =
  | {
      kind: "prepare"
      reject: (reason: Error) => void
      resolve: () => void
    }
  | {
      kind: "refine"
      reject: (reason: Error) => void
      resolve: (frame: { mask: Uint8Array; blob?: Blob }) => void
    }

interface QueuedRefinement {
  encode: boolean
  points: readonly PinMaskPoint[]
  reject: (reason: Error) => void
  resolve: (frame: { mask: Uint8Array; blob?: Blob }) => void
}

/** Identifies work superseded by a newer refinement request rather than a worker failure. */
export class QuickSelectionWorkerAbortError extends Error {
  constructor(message = "Pin mask work was superseded.") {
    super(message)
    this.name = "AbortError"
  }
}

export function isQuickSelectionWorkerAbortError(
  reason: unknown,
): reason is QuickSelectionWorkerAbortError {
  return reason instanceof QuickSelectionWorkerAbortError
}

/**
 * Main-thread client for the pin-mask worker.
 *
 * The client owns lifecycle, request correlation, and latest-only refinement scheduling. It never
 * exposes the mutable WASM engine to React. A prepared pixel buffer is consumed by `prepare` and
 * transferred to the worker; callers must not use that typed array after the call.
 */
export class QuickSelectionWorkerClient {
  #disposed = false
  #failure: Error | undefined
  #nextRequestId = 0
  #refineInFlight = false
  #queuedRefinement: QueuedRefinement | undefined
  readonly #pending = new Map<number, PendingRequest>()
  readonly #worker: Worker

  constructor() {
    this.#worker = new Worker(new URL("./quick-selection-worker.ts", import.meta.url), {
      type: "module",
    })
    this.#worker.addEventListener(
      "message",
      (event: MessageEvent<QuickSelectionWorkerResponse>) => {
        this.#accept(event.data)
      },
    )
    this.#worker.addEventListener("error", () => {
      this.#fail(new Error("The pin mask worker stopped unexpectedly."))
    })
    this.#worker.addEventListener("messageerror", () => {
      this.#fail(new Error("The pin mask worker returned unreadable data."))
    })
  }

  /** Consumes a cloned artwork bitmap; native pixel readback happens inside the worker. */
  prepareBitmap(bitmap: ImageBitmap) {
    if (this.#failure || this.#disposed) {
      bitmap.close()
      return Promise.reject(this.#failure ?? new QuickSelectionWorkerAbortError())
    }
    return new Promise<void>((resolve, reject) => {
      this.#post(
        { id: this.#nextId(), bitmap, type: "prepare-bitmap" },
        { kind: "prepare", reject, resolve },
        [bitmap],
      )
    })
  }

  prepare(rgba: Uint8ClampedArray, width: number, height: number) {
    if (this.#failure) return Promise.reject(this.#failure)
    if (this.#disposed)
      return Promise.reject(new QuickSelectionWorkerAbortError("Pin mask worker was closed."))
    // ImageData normally has an exact, zero-offset buffer. Normalize other views before transfer
    // so the worker receives precisely width × height × 4 bytes rather than an enclosing buffer.
    const transferable =
      rgba.byteOffset === 0 && rgba.byteLength === rgba.buffer.byteLength ? rgba : rgba.slice()
    const buffer = transferable.buffer
    return new Promise<void>((resolve, reject) => {
      this.#post(
        {
          height,
          id: this.#nextId(),
          rgba: buffer as ArrayBuffer,
          type: "prepare",
          width,
        },
        { kind: "prepare", reject, resolve },
        [buffer as ArrayBuffer],
      )
    })
  }

  /** Queues only the newest point set while an older refinement is running in the worker. */
  refine(points: readonly PinMaskPoint[]) {
    return this.#refine(points, false).then(({ mask }) => mask)
  }

  /** Publishes pixels and their persisted PNG together, with encoding performed in the worker. */
  refineEncoded(points: readonly PinMaskPoint[]) {
    return this.#refine(points, true).then(({ mask, blob }) => {
      if (!blob) throw new Error("The pin mask worker did not return an encoded mask.")
      return { mask, blob }
    })
  }

  #refine(points: readonly PinMaskPoint[], encode: boolean) {
    if (this.#failure) return Promise.reject(this.#failure)
    if (this.#disposed)
      return Promise.reject(new QuickSelectionWorkerAbortError("Pin mask worker was closed."))
    return new Promise<{ mask: Uint8Array; blob?: Blob }>((resolve, reject) => {
      this.#queuedRefinement?.reject(new QuickSelectionWorkerAbortError())
      this.#queuedRefinement = { encode, points: [...points], reject, resolve }
      this.#flushRefinement()
    })
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#fail(new QuickSelectionWorkerAbortError("Pin mask worker was closed."))
  }

  #nextId() {
    this.#nextRequestId += 1
    return this.#nextRequestId
  }

  #post(
    request: QuickSelectionWorkerRequest,
    pending: PendingRequest,
    transfer: Transferable[] = [],
  ) {
    this.#pending.set(request.id, pending)
    try {
      this.#worker.postMessage(request, transfer)
    } catch (reason) {
      if (request.type === "prepare-bitmap") request.bitmap.close()
      this.#pending.delete(request.id)
      const error = reason instanceof Error ? reason : new Error("Could not send pin mask work.")
      pending.reject(error)
      this.#fail(error)
    }
  }

  #flushRefinement() {
    if (this.#refineInFlight || !this.#queuedRefinement || this.#failure || this.#disposed) return
    const queued = this.#queuedRefinement
    this.#queuedRefinement = undefined
    this.#refineInFlight = true
    this.#post(
      { id: this.#nextId(), points: queued.points, encode: queued.encode, type: "refine" },
      { kind: "refine", reject: queued.reject, resolve: queued.resolve },
    )
  }

  #accept(response: QuickSelectionWorkerResponse) {
    const pending = this.#pending.get(response.id)
    if (!pending) return
    this.#pending.delete(response.id)
    if (pending.kind === "refine") this.#refineInFlight = false

    if (response.type === "error") {
      pending.reject(new Error(response.message))
    } else if (response.type === "prepared" && pending.kind === "prepare") {
      pending.resolve()
    } else if (response.type === "refined" && pending.kind === "refine") {
      pending.resolve({
        mask: new Uint8Array(response.mask),
        ...(response.blob ? { blob: response.blob } : {}),
      })
    } else {
      pending.reject(new Error("The pin mask worker returned an invalid response."))
    }
    this.#flushRefinement()
  }

  #fail(error: Error) {
    if (this.#failure) return
    this.#failure = error
    this.#worker.terminate()
    this.#pending.forEach(({ reject }) => reject(error))
    this.#pending.clear()
    this.#queuedRefinement?.reject(error)
    this.#queuedRefinement = undefined
    this.#refineInFlight = false
  }
}
