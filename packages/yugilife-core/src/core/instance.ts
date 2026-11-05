// One instance of the WebAssembly core and its call interface: a call is a pack (see
// `encodePack`) and returns a JSON response plus the binary buffers it refers to.

export type PackFile = readonly [name: string, bytes: ArrayBuffer]

export interface CallReply {
  readonly buffers: readonly ArrayBuffer[]
  readonly response: unknown
}

interface CoreExports {
  readonly memory: WebAssembly.Memory
  yl_alloc(length: number): number
  yl_call(pointer: number, length: number): number
  yl_free(pointer: number, length: number): void
  yl_output_count(): number
  yl_output_len(index: number): number
  yl_output_ptr(index: number): number
}

/**
 * Encodes a call as the module reads it: a little-endian `u32` header length, the JSON header with
 * a `files` index of `[offset, length]` entries added, then every file's bytes.
 */
export function encodePack(
  header: Readonly<Record<string, unknown>>,
  files: readonly PackFile[] = [],
) {
  const ranges: Record<string, readonly [number, number]> = {}
  let length = 0
  for (const [name, bytes] of files) {
    ranges[name] = [length, bytes.byteLength]
    length += bytes.byteLength
  }
  const json = new TextEncoder().encode(JSON.stringify({ ...header, files: ranges }))
  const pack = new Uint8Array(4 + json.length + length)
  new DataView(pack.buffer).setUint32(0, json.length, true)
  pack.set(json, 4)
  let offset = 4 + json.length
  for (const [, bytes] of files) {
    pack.set(new Uint8Array(bytes), offset)
    offset += bytes.byteLength
  }
  return pack
}

const EBADF = 8
const ENOENT = 44
const decoder = new TextDecoder()

export class CoreInstance {
  #exports: CoreExports | undefined
  #diagnostics = ""

  static async create(module: WebAssembly.Module) {
    const core = new CoreInstance()
    const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: core.#wasi() })
    core.#exports = instance.exports as unknown as CoreExports
    return core
  }

  #memory() {
    if (!this.#exports) throw new Error("The yugilife-core module is not available.")
    return this.#exports.memory.buffer
  }

  /**
   * The WASI imports of a `wasm32-wasip1` module. The core reads no files, environment, or clock;
   * it needs randomness for hash maps and an output stream for panic messages.
   */
  #wasi() {
    return {
      random_get: (pointer: number, length: number) => {
        crypto.getRandomValues(new Uint8Array(this.#memory(), pointer, length))
        return 0
      },
      environ_get: () => 0,
      environ_sizes_get: (count: number, size: number) => {
        const view = new DataView(this.#memory())
        view.setUint32(count, 0, true)
        view.setUint32(size, 0, true)
        return 0
      },
      clock_time_get: (_id: number, _precision: bigint, out: number) => {
        new DataView(this.#memory()).setBigUint64(
          out,
          BigInt(Math.round(performance.now() * 1e6)),
          true,
        )
        return 0
      },
      fd_write: (_fd: number, iovs: number, count: number, written: number) => {
        const view = new DataView(this.#memory())
        let total = 0
        for (let index = 0; index < count; index += 1) {
          const pointer = view.getUint32(iovs + index * 8, true)
          const length = view.getUint32(iovs + index * 8 + 4, true)
          this.#diagnostics += decoder.decode(new Uint8Array(this.#memory(), pointer, length))
          total += length
        }
        view.setUint32(written, total, true)
        return 0
      },
      fd_close: () => EBADF,
      fd_fdstat_get: () => EBADF,
      fd_filestat_get: () => EBADF,
      fd_prestat_get: () => EBADF,
      fd_prestat_dir_name: () => EBADF,
      fd_read: () => EBADF,
      path_filestat_get: () => ENOENT,
      path_open: () => ENOENT,
      proc_exit: (code: number): never => {
        throw new Error(`The yugilife-core module exited with code ${code}.`)
      },
      sched_yield: () => 0,
    }
  }

  call(header: Readonly<Record<string, unknown>>, files: readonly PackFile[] = []): CallReply {
    const core = this.#exports
    if (!core)
      throw new Error("The yugilife-core module failed earlier and is no longer available.")
    const pack = encodePack(header, files)
    const pointer = core.yl_alloc(pack.length)
    new Uint8Array(this.#memory(), pointer, pack.length).set(pack)
    let status: number
    try {
      this.#diagnostics = ""
      status = core.yl_call(pointer, pack.length)
    } catch (error) {
      // A panic aborts the module: its memory can no longer be trusted, so later calls fail too.
      this.#exports = undefined
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`The yugilife-core module failed: ${this.#diagnostics.trim() || reason}`, {
        cause: error,
      })
    } finally {
      this.#exports?.yl_free(pointer, pack.length)
    }
    const outputs: ArrayBuffer[] = []
    for (let index = 0; index < core.yl_output_count(); index += 1) {
      const view = new Uint8Array(
        this.#memory(),
        core.yl_output_ptr(index),
        core.yl_output_len(index),
      )
      outputs.push(view.slice().buffer)
    }
    const [first, ...buffers] = outputs
    const text = decoder.decode(first)
    if (status !== 0) throw new Error(text)
    return { buffers, response: JSON.parse(text) as unknown }
  }
}
