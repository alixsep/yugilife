# Performance

> Recorded while this renderer was a port of the TypeScript renderer, with the comparison tooling of the original `yugilife-rust` workspace (`reference/`, `benchmark/`, `snapshots/`), which stays there.

## Environment

|          |                                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| CPU      | Intel Core i7-12700H (6 performance + 8 efficiency cores, 20 threads), laptop on AC power, `powersave` governor                          |
| Memory   | 15 GB                                                                                                                                    |
| OS       | Fedora Linux 44, kernel 7.2.5                                                                                                            |
| Rust     | 1.98.1, `--release` (fat LTO, one codegen unit, `target-cpu=x86-64-v2`)                                                                  |
| Original | `yugilife-cli` 0.1.0 + `@yugilife/core` built from the YugiLife repository, Playwright Chromium 151.0.7922.34 (build 1234), Node 24.16.0 |

## Workload

- 250 cards drawn from the app's card catalog (`apps/yugilife/public/card-catalog`, 13,632 eligible entries) with mulberry32 seed `0x5eed2026` (`benchmark/cards.json`).
- Every card uses the packaged `card/series-10` template and two local AVIF artworks from `materials/artworks/processed` (2048-pixel 4× upscales plus their alpha overlays). No substitute assets.
- Output is PNG at native size (813×1185).

## Method

- **Original** (`reference/original-harness.mjs --mode bench`):
  - One Chromium page is launched and warmed on 12 extra cards.
  - Every card is then rendered through the CLI's own request loader and browser renderer: read and encode the input, render and encode the PNG in the page, decode and write the file.
  - One pass covers all 250 cards in sequence, which is how the CLI works.
  - A separate pass times `renderCard` plus `toImage` inside the page (core only).
- **Rust** (`reference/rust-harness.mjs`):
  - One unrecorded warmup pass, then 5 recorded passes of `yugilife-cli render-batch` over the same 250 inputs. Each pass is one process, timed from spawn to exit, so startup is included.
  - Run once with all 20 threads (`--jobs 20`) and once sequentially (`--jobs 1`).
  - Per-card load, render, encode and write times come from `--timings`.
  - Process startup (`--version`) and one cold `render` process per card are measured separately.
- **Memory**: both harnesses sample the resident set of the whole process tree through `/proc` (`reference/memory.mjs`).

## Results

Same session, idle machine, identical inputs:

|                       | Original (warm Chromium page)   | Rust, 20 threads                   | Rust, 1 thread                    |
| --------------------- | ------------------------------- | ---------------------------------- | --------------------------------- |
| 250-card pass, median | 96.7 s (passes: 96.1 s, 97.3 s) | **2.13 s** (5 passes, 2.11–2.16 s) | 17.50 s (5 passes, 17.48–17.72 s) |
| Per card (pass ÷ 250) | 386.8 ms                        | **8.53 ms**                        | 70.0 ms                           |
| Speedup, end to end   | 1×                              | **45×**                            | **5.5×**                          |
| Peak process-tree RSS | 8,256 MB¹                       | 543 MB                             | 132 MB                            |

Rust per-card breakdown, sequential means:

| Stage                    | Time                                                       |
| ------------------------ | ---------------------------------------------------------- |
| Input load and file read | 0.16 ms                                                    |
| Render                   | 55.4 ms (≈47 ms of it is dav1d decoding the 2048² artwork) |
| PNG encode               | 14.0 ms                                                    |
| Write                    | 0.55 ms                                                    |
| Core (render + encode)   | 69.4 ms                                                    |

Startup and cold runs:

- Process startup (`yugilife-cli --version`) takes 2.05 ms (median).
- A cold single-card `yugilife-cli render`, including process start, template load and every decode, takes 118.6 ms (median of 250) with 82 MB peak RSS.
- For comparison, the original needs 887 ms just to launch Chromium before it can render anything.

¹ This peak was measured in the earlier full run (`benchmark/results/original/report.json`). The same-session run was stopped by the host for low system memory during its third pass, after its two end-to-end passes had completed. Those pass times come from `benchmark/results/original-bench.log`. Its core-only pass and the original's cold-invocation series (`--mode cold`) did not run.

## Assessment

**The 100× target is not reached under equal conditions.**

- The best measured result is **45×** end-to-end throughput with all cores.
- Single-threaded it is **5.5×**.
- Peak memory is roughly **15× lower**.

The earlier full run of the original is not a valid baseline:

- It measured 313 s per pass (1,253 ms per card end to end, 552 ms per card core).
- Against that run the Rust batch would be 146× faster.
- But it was recorded while the machine was busy with other work. The same-session idle measurement is 3.2× faster, so that run is kept only for reference.

Why 100× is out of reach on this workload:

- **Decoding floor.** Each card must decode a 2048×2048 AV1 image. dav1d, the same decoder Chromium uses, spends about 47 ms of the 70 ms single-threaded budget on it. AV1 intra frames cannot be decoded at reduced resolution, and the result must be exact.
- **Chromium already overlaps work.** The original's 387 ms per card includes Chromium's multi-threaded image decoding and its native Skia drawing. The JavaScript-to-native overhead the port removes is only part of that time.
- **What parallelism buys.** The batch path spreads cards over all cores. It reaches about 8.2× over its own sequential time and is limited by memory bandwidth on this 6P+8E laptop.

## Optimizations applied

- A process-wide template bundle cache in the CLI. Decoded template images, fonts, graded textures and prepared masks are reused across cards.
- AVIF images are kept as YUV planes. The mip level the draw needs is converted and box-filtered in a single streaming pass, and the full-size RGBA base is only built if something samples it.
- Direct row blending for unscaled draws at integer offsets.
- Lookup tables for the unpremultiply and `destination-in` float models.
- Pooled layer surfaces that are cleared by dirty rectangle.
- Paeth-filtered fast PNG compression.
- For single `render` invocations dav1d runs multi-threaded; `render-batch` parallelizes across cards instead.

## Reproducing

```sh
cargo build --release
node reference/rust-harness.mjs --repeats 5
node reference/original-harness.mjs --mode bench --repeats 3
node reference/original-harness.mjs --mode cold --cards 25
```

Run the two harnesses back to back on an otherwise idle machine. The original needs about 9 GB of free memory for its Chromium process tree.
