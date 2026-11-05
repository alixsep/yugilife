# WebAssembly

`crates/yugilife-wasm` builds the renderer for browsers. [`packages/yugilife-core`](../../packages/yugilife-core)
is its JavaScript API, with the types and function names the TypeScript renderer had.

## Build

```sh
pnpm --filter yugilife-core build   # packages/yugilife-core/scripts/build-wasm.mjs
```

- Target: `wasm32-wasip1`. rav1d, the AV1 decoder, does not build for `wasm32-unknown-unknown`. The module imports 15 WASI functions, none of which the core relies on; `packages/yugilife-core/src/core/instance.ts` stubs them.
- `simd128` is enabled in `.cargo/config.toml`. The `wasm` profile is `release` without the function name section.
- rav1d provides the dav1d C API on WebAssembly, so the build script keeps `dav1d-sys` from looking for a system library.

| Concern             | Native                 | WebAssembly                                                              |
| ------------------- | ---------------------- | ------------------------------------------------------------------------ |
| Autohinted advances | skrifa                 | skrifa                                                                   |
| AVIF                | dav1d (system library) | the browser's AV1 decoder where it provides YUV planes, otherwise rav1d  |
| WebP decoding       | libwebp                | `image` crate (exact for lossless WebP, which every packaged texture is) |
| WebP encoding       | libwebp                | the browser's encoder, from the same pixels                              |

## The module's interface

Calls go through one export, `yl_call`, with a pack: a little-endian `u32` header length, a JSON header naming an `op`, then the files the header addresses as `[offset, length]`. The reply is a JSON response followed by binary buffers it refers to by index.

- `src/sync.rs`: the synchronous API (validation, semantics, presentation, rich text, layer-tree queries, template versions, raster sizes). Templates and layer arrays are registered once and referred to by key.
- `src/app.rs`: `loadTemplate`, `render` (live and outlined segments, SVG, PNG, JPEG, or pixels for WebP), `manifest` and `manifestAlpha`.
- `src/avif.rs`: `avifItems` and `provideAvif`, for decoding AVIF in the browser.
- `src/harness.rs`: `yl_load_bundle` and `yl_render`, CLI-shaped entry points for comparing with the native CLI.

`tests/app.rs` drives the operations natively and checks that a render returns the same bytes as the native API.

## In the browser

Importing `yugilife-core` compiles the module once (top-level await) and instantiates it on the page for the synchronous API. Rendering runs in a Web Worker that receives the compiled module, one call at a time; a call whose signal aborts while it waits is dropped. Without a `Worker` (Node), rendering runs in the same thread.

Caching:

- A template bundle is loaded into the core once per bundle object and released when the object is collected.
- Decoded card assets stay decoded from one render to the next while their bytes are unchanged (`RenderOptions::decoded_assets`); a render keeps only what it used.
- The service worker caches the hashed `.wasm` and worker files like every other asset.

AVIF: before a render, the worker passes each AVIF asset's AV1 items to WebCodecs (`prefer-software`) and gives the planes to the core, which reads the color metadata from the AV1 sequence headers itself (`raster/av1.rs`, checked against dav1d by `tests/av1_sequence.rs`) and converts as before. AV1 decoding is exact by specification. A browser that only returns RGB frames (Firefox returns `BGRX`) is not asked again in that session, and the core decodes with rav1d.

## Results

Measured 2026-11-04, 40 catalog cards with artwork, rendering to PNG through `exportCardToImage` in a production build:

| Median per card | Chromium 151 | Firefox 155 |
| --------------- | ------------ | ----------- |
| First render    | 78 ms        | 252 ms      |
| Render again    | 51 ms        | 36 ms       |

All 80 PNGs were byte-identical to the native CLI's. Before decoding AVIF in the browser, a first render took 255 ms in Chromium. Firefox 153, the build Playwright 1.62 installs, runs WebAssembly about ten times slower than Firefox 155; timings from it are not representative.

The module is 5.3 MB, 1.35 MB with brotli. Before the TypeScript renderer was archived, its exported functions were compared with this API on about 1.44 million inputs (the card catalog, generated overrides, rich text, and invalid templates, manifests, presets, and card data); results, thrown error classes, and messages all matched.

## Open

- The Pages job compiles the module from scratch on every deploy; nothing caches Cargo's output yet.
- Lossy WebP uploads decode with the `image` crate on WebAssembly and libwebp natively, which are not guaranteed to agree.
- Safari is not tested.
