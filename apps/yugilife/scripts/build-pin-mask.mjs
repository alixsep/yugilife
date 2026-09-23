import { execFileSync } from "node:child_process"
import { accessSync, constants } from "node:fs"
import { fileURLToPath } from "node:url"

const directory = fileURLToPath(new URL("../src/lib/pin-mask/", import.meta.url))
const source = fileURLToPath(
  new URL("../src/lib/pin-mask/quick-selection-kernels.c", import.meta.url),
)
const output = fileURLToPath(
  new URL("../src/lib/pin-mask/quick-selection-kernels.wasm", import.meta.url),
)
// The worker bounds dot segmentation to a 768px working plane, while mask effects can still
// process a native 4K mask. Keep one explicit ceiling for both paths instead of relying on a
// browser-specific default maximum.
const wasmMaxMemory = 128 * 1024 * 1024

try {
  accessSync(source, constants.R_OK)
} catch {
  throw new Error(`Pin mask kernel source is missing: ${source}`)
}

try {
  execFileSync("wasm-ld", ["--version"], { stdio: "ignore" })
} catch {
  throw new Error(
    "The pin mask build requires clang and wasm-ld. Install the WebAssembly LLVM linker or add it to PATH before running build:pin-mask.",
  )
}

execFileSync(
  "clang",
  [
    "--target=wasm32",
    "-O3",
    "-flto",
    "-nostdlib",
    "-Wl,--no-entry",
    "-Wl,--export-memory",
    "-Wl,--initial-memory=131072",
    `-Wl,--max-memory=${wasmMaxMemory}`,
    "-Wl,--export=reset_heap",
    "-Wl,--export=alloc",
    "-Wl,--export=quick_prepare",
    "-Wl,--export=quick_refine",
    "-Wl,--export=quick_error",
    "-Wl,--export=mask_effects_apply",
    "-Wl,--export=mask_alpha_smooth",
    "-Wl,--export=mask_alpha_glow",
    "-o",
    output,
    source,
  ],
  { cwd: directory, stdio: "inherit" },
)

console.log(`Built ${output}`)
