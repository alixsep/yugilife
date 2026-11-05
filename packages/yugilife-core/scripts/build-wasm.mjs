// Builds the Rust core for WebAssembly (crates/yugilife-wasm) and places the module in this
// package. Needs rustup; `rust-toolchain.toml` pins the release and the wasm32-wasip1 target.
// YUGILIFE_CORE_WASM names a module built elsewhere (a Docker build stage) to use instead.
import { copyFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { runCommand } from "../../../scripts/run-command.mjs"

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repository = path.resolve(packageDirectory, "../..")
const target = path.join(packageDirectory, "wasm/yugilife_core.wasm")
const targetDirectory = path.resolve(repository, process.env["CARGO_TARGET_DIR"] || "target")
const built = path.join(targetDirectory, "wasm32-wasip1/wasm/yugilife_wasm.wasm")

/** A setup problem with a complete explanation; reported without a stack trace. */
class MissingToolError extends Error {}

async function build(signal) {
  // rav1d provides the dav1d C API on WebAssembly (see crates/yugilife-core/Cargo.toml), so
  // dav1d-sys must not look for a system libdav1d. system-deps requires at least one library name
  // once pkg-config is off; libc is linked into every wasm32-wasip1 module anyway.
  process.env["SYSTEM_DEPS_DAV1D_NO_PKG_CONFIG"] = "1"
  process.env["SYSTEM_DEPS_DAV1D_LIB"] = "c"
  try {
    await runCommand(
      "cargo",
      ["build", "--profile", "wasm", "-p", "yugilife-wasm", "--target", "wasm32-wasip1"],
      { cwd: repository, label: "Building the WebAssembly core", signal, timeoutMs: 30 * 60_000 },
    )
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
    throw new MissingToolError(
      [
        "Building yugilife-core needs Rust, and `cargo` is not on PATH.",
        "Install rustup from https://rustup.rs; it installs the pinned release on first use.",
        "If Rust is already installed, add its bin directory to PATH in your shell profile;",
        'for rustup that is `. "$HOME/.cargo/env"`.',
      ].join("\n"),
      { cause: error },
    )
  }
}

const prebuilt = process.env["YUGILIFE_CORE_WASM"]
const interruption = new AbortController()
let interruptedSignal
const handleSignal = (signal) => {
  if (interruptedSignal) return
  interruptedSignal = signal
  interruption.abort(new Error(`The WebAssembly core build was interrupted by ${signal}.`))
}
const interrupt = () => handleSignal("SIGINT")
const terminate = () => handleSignal("SIGTERM")
process.on("SIGINT", interrupt)
process.on("SIGTERM", terminate)
let failure
try {
  if (!prebuilt) await build(interruption.signal)
  await mkdir(path.dirname(target), { recursive: true })
  await copyFile(prebuilt ?? built, target)
  console.log(`Placed ${path.relative(repository, target)}`)
} catch (error) {
  failure = error
} finally {
  process.off("SIGINT", interrupt)
  process.off("SIGTERM", terminate)
}
if (interruptedSignal) {
  console.error(`The WebAssembly core build was interrupted by ${interruptedSignal}.`)
  process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143
} else if (failure instanceof MissingToolError) {
  console.error(failure.message)
  process.exitCode = 1
} else if (failure) {
  throw failure
}
