import type { PackFile } from "../core/instance"

export type WorkerMessage =
  | { readonly kind: "init"; readonly module: WebAssembly.Module }
  | {
      readonly files: readonly PackFile[]
      readonly header: Readonly<Record<string, unknown>>
      readonly id: number
      readonly kind: "call"
    }

export type WorkerResult =
  | {
      readonly buffers: readonly ArrayBuffer[]
      readonly id: number
      readonly ok: true
      readonly response: unknown
    }
  | { readonly id: number; readonly message: string; readonly ok: false }
