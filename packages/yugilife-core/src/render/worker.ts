/// <reference lib="webworker" />
// Renders in the background. The page posts its compiled module first; calls then run one at a
// time, in order. The module is synchronous, so a long render delays only later calls.

import { CoreInstance } from "../core/instance"

import { predecodeAvif } from "./av1-decoder"

import type { WorkerMessage, WorkerResult } from "./messages"

declare const self: DedicatedWorkerGlobalScope

let instance: Promise<CoreInstance> | undefined

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data
  if (message.kind === "init") {
    instance = CoreInstance.create(message.module)
    return
  }
  void (async (): Promise<WorkerResult> => {
    try {
      if (!instance) throw new Error("The render worker received a call before its module.")
      const core = await instance
      await predecodeAvif(core, message.header, message.files)
      const { buffers, response } = core.call(message.header, message.files)
      return { buffers, id: message.id, ok: true, response }
    } catch (error) {
      return {
        id: message.id,
        message: error instanceof Error ? error.message : String(error),
        ok: false,
      }
    }
  })().then((result) => self.postMessage(result, result.ok ? [...result.buffers] : []))
}
