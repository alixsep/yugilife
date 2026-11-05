# Yugilife renderer (Rust)

The one implementation of Yugilife's card renderer. The website runs it as WebAssembly through
[`packages/yugilife-core`](../packages/yugilife-core); the command line runs it natively.

| Crate                | Contents                                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yugilife-core`      | Validation, semantics, presentation, rich text, text layout and outlining, raster pipeline, SVG and raster export, render manifests                   |
| `yugilife-cli`       | The `yugilife-cli` binary: `render`, `render-batch`, `doctor`, `templates list` and `templates install`, with the packaged official template embedded |
| `yugilife-wasm`      | The WebAssembly build behind `packages/yugilife-core`: synchronous queries, rendering, and AVIF decoding by the browser                               |
| `yugilife-snapshots` | `snapshot-diff`, which compares two directories of rendered cards pixel by pixel and SVG token by token                                               |

## Build and verify

`rust-toolchain.toml` pins the Rust release (1.98.1) that builds both the native binaries and the
WebAssembly module; `rust-version` in `Cargo.toml` (1.90) is only the minimum Cargo accepts. Native builds need the `libdav1d` shared library; Fedora ships it without a
development link, so `.cargo/dav1d` holds a pkg-config file that `.cargo/config.toml` selects.

```sh
cargo build --release
pnpm check:rust                      # cargo fmt --check, clippy with warnings as errors, cargo test
pnpm --filter yugilife-core build   # the WebAssembly build, placed in packages/yugilife-core/wasm
```

`pnpm --filter yugilife-core build` runs the WebAssembly build and copies the module into the
package. rustup installs the `wasm32-wasip1` target it needs from `rust-toolchain.toml`.

## Command line

```sh
target/release/yugilife-cli doctor
target/release/yugilife-cli render card.json --output card.png
target/release/yugilife-cli render card.json --output card.svg --text-mode text --title "My card"
target/release/yugilife-cli render card.json --output card.jpg --width 406 --quality 90 --background "#000"
target/release/yugilife-cli render-batch cards/*.json --output-dir out \
  --format png,svg,text.svg,warnings.json --jobs 8 --timings out/timings.json
target/release/yugilife-cli templates list
target/release/yugilife-cli templates install card/series-10@2026.09.23 --registry file:///path/to/catalog.json
```

An input is JSON with `card`, optional `files` (paths relative to the input, for image fields), an
optional `template`, and optional `presentationOverrides`.

The CLI embeds the official templates from `yugilife-cli/templates`: the templates package's
`catalog.json` plus `dist/assets/templates` and `dist/assets/shared` from its build. The templates
build fails while this copy is stale; `pnpm --filter yugilife-templates generate:cli-templates`
rewrites it from the current build.

## History

This renderer began as a port of the TypeScript renderer, which it matched pixel for pixel before
replacing it. The TypeScript renderer and its command line remain in the repository's history
(`packages/yugilife-core` and `packages/yugilife-cli` up to commit `eed78a3`). [docs/FIDELITY.md](docs/FIDELITY.md)
records how the port reproduced Chromium's output, [docs/PERFORMANCE.md](docs/PERFORMANCE.md) its
speed against the TypeScript renderer, and [docs/WASM.md](docs/WASM.md) the WebAssembly build.
