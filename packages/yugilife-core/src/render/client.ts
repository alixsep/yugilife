// The page's side of rendering: calls run one at a time in order, and a call whose signal aborts
// while it waits is dropped before it reaches the core. An editor that re-renders on every edit
// therefore renders only the latest card once the core frees up.
//
// Rendering runs in a Web Worker that shares the page's compiled module. Where there is no Worker
// (Node), it runs on an instance in the same thread.

import { CoreInstance } from "../core/instance"
import { coreModule } from "../core/module"

import type { CallReply, PackFile } from "../core/instance"
import type { WorkerMessage, WorkerResult } from "./messages"

interface Job {
  readonly files: readonly PackFile[]
  readonly header: Readonly<Record<string, unknown>>
  readonly reject: (reason: unknown) => void
  readonly resolve: (reply: CallReply) => void
  readonly signal?: AbortSignal | undefined
}

export function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Rendering was aborted.", "AbortError")
}

interface Backend {
  run(job: Job & { readonly id: number }): void
}

let backend: Promise<Backend> | undefined
let nextId = 1
let running: (Job & { readonly id: number }) | undefined
const queue: Job[] = []

function settle(job: Job, result: WorkerResult) {
  if (job.signal?.aborted) job.reject(abortReason(job.signal))
  else if (result.ok) job.resolve({ buffers: result.buffers, response: result.response })
  else job.reject(new Error(result.message))
}

function finish(result: WorkerResult) {
  const job = running
  running = undefined
  if (job?.id === result.id) settle(job, result)
  pump()
}

function failAll(error: Error) {
  const jobs = running ? [running, ...queue] : [...queue]
  running = undefined
  queue.length = 0
  for (const job of jobs) job.reject(error)
}

function workerBackend(module: WebAssembly.Module): Backend {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), {
    name: "yugilife-core",
    type: "module",
  })
  worker.onmessage = (event: MessageEvent<WorkerResult>) => finish(event.data)
  worker.onerror = (event) => {
    event.preventDefault()
    worker.terminate()
    backend = undefined
    failAll(
      new Error(`The yugilife-core render worker failed: ${event.message || "unknown error"}`),
    )
  }
  worker.postMessage({ kind: "init", module } satisfies WorkerMessage)
  return {
    run({ files, header, id }) {
      worker.postMessage({ files, header, id, kind: "call" } satisfies WorkerMessage)
    },
  }
}

async function localBackend(module: WebAssembly.Module): Promise<Backend> {
  const instance = await CoreInstance.create(module)
  return {
    run({ files, header, id }) {
      queueMicrotask(() => {
        try {
          const { buffers, response } = instance.call(header, files)
          finish({ buffers, id, ok: true, response })
        } catch (error) {
          finish({ id, message: error instanceof Error ? error.message : String(error), ok: false })
        }
      })
    },
  }
}

function renderBackend() {
  backend ??= coreModule.then((module) =>
    typeof Worker === "undefined" ? localBackend(module) : workerBackend(module),
  )
  return backend
}

function pump() {
  if (running) return
  let job = queue.shift()
  while (job?.signal?.aborted) {
    job.reject(abortReason(job.signal))
    job = queue.shift()
  }
  if (!job) return
  const started = { ...job, id: nextId++ }
  running = started
  renderBackend().then(
    (current) => current.run(started),
    (error: unknown) => failAll(error instanceof Error ? error : new Error(String(error))),
  )
}

/** Runs one render call. The files are copied, so the caller may send them again. */
export function call(
  header: Readonly<Record<string, unknown>>,
  files: readonly PackFile[] = [],
  signal?: AbortSignal,
): Promise<CallReply> {
  if (signal?.aborted) return Promise.reject(abortReason(signal))
  return new Promise<CallReply>((resolve, reject) => {
    const job: Job = { files, header, reject, resolve, signal }
    signal?.addEventListener(
      "abort",
      () => {
        const index = queue.indexOf(job)
        if (index >= 0) {
          queue.splice(index, 1)
          reject(abortReason(signal))
        }
      },
      { once: true },
    )
    queue.push(job)
    pump()
  })
}
