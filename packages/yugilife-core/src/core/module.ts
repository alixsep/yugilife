// Compiles the WebAssembly core once per JavaScript realm. The page and its render worker share the
// compiled module: the page posts it to the worker rather than the worker fetching it again.

const runtime = globalThis as { process?: { versions?: { node?: string } } }

async function compile(): Promise<WebAssembly.Module> {
  if (typeof runtime.process?.versions?.node === "string") {
    // Node, including test runners: read the file next to this source. The URL is built from a
    // variable so bundlers leave it alone; browsers take the asset URL below.
    const relative = "../../wasm/yugilife_core.wasm"
    const fs = "node:fs/promises"
    const { readFile } = (await import(/* @vite-ignore */ fs)) as {
      readFile: (path: URL) => Promise<Uint8Array<ArrayBuffer>>
    }
    let bytes: Uint8Array<ArrayBuffer>
    try {
      bytes = await readFile(new URL(relative, import.meta.url))
    } catch (error) {
      if ((error as { code?: unknown }).code !== "ENOENT") throw error
      throw new Error(
        "The yugilife-core WebAssembly module has not been built. Run `pnpm --filter yugilife-core build`.",
        { cause: error },
      )
    }
    return await WebAssembly.compile(bytes)
  }
  const url = new URL("../../wasm/yugilife_core.wasm", import.meta.url)
  try {
    return await WebAssembly.compileStreaming(fetch(url))
  } catch {
    // A server that does not send `application/wasm` rules out streaming compilation.
    const response = await fetch(url)
    if (!response.ok)
      throw new Error(`Could not load the yugilife-core module: HTTP ${response.status}.`)
    return await WebAssembly.compile(await response.arrayBuffer())
  }
}

export const coreModule: Promise<WebAssembly.Module> = compile()
