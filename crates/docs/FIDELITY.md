# Fidelity

> Recorded while this renderer was a port of the TypeScript renderer, with the comparison tooling of the original `yugilife-rust` workspace (`reference/`, `benchmark/`, `snapshots/`), which stays there.

The original's output is whatever Chromium 151 (Playwright build 1234) and its Skia draw. The port therefore reimplements the specific arithmetic that decides each output pixel, rather than approximating it with a general-purpose 2D library. Every model below was derived by probing Chromium directly, with the harnesses in `reference/`, until the Rust output matched bit for bit. Where Skia code is involved, the port follows the `chrome/m151` Skia sources.

## Results

`snapshot-diff` over the 250 benchmark cards (`snapshots/report.json`):

| Check                                                                           | Result                       |
| ------------------------------------------------------------------------------- | ---------------------------- |
| Text-mode SVG, byte-identical after excluding embedded raster data              | 250 / 250                    |
| Paths-mode SVG structure (glyph outlines, transforms, numbers), token-identical | 250 / 250                    |
| Raster planes embedded in the SVG, pixel-identical                              | 250 / 250                    |
| Warnings (codes, layer IDs, UTF-16 offsets, messages)                           | 250 / 250                    |
| PNG export, pixel-identical                                                     | 150 / 250                    |
| PNG export, differing pixels overall                                            | 713 of 240,851,250 (0.0003%) |
| Worst card, pixels with a channel difference above 8                            | 0.0018%                      |

Other outputs verified the same way:

- Render manifests: every element's layer, order, source fields, bounds, and absolute and visible alpha planes are identical for a spell/trap card and a pendulum monster card (`reference/compare-manifest.py`).
- Prepared textures: all 16 payloads of the packaged template have the same keys, order and pixel planes as the original's `prepareTemplateTextures`. They were removed later, along with the TypeScript renderer that used them.

## What is reproduced

Text:

- `CanvasRenderingContext2D.measureText`: integer font sizes, FreeType fixed-point advance rounding, kerning scaled in HarfBuzz's 16.16 fixed point and then rounded, and FreeType autohinting for TrueType fonts without hinting instructions. The autohinted advances come from skrifa's port of the FreeType autohinter; `tests/text_metrics.rs` checks them against FreeType for every glyph of the packaged autohinted fonts.
- The SVG text layout algorithm: per-item 16.16 accumulation, `textLength` with `spacingAndGlyphs` and `spacing`, anchoring, and the `getStartPositionOfChar` and `getSubStringLength` queries. The queries include the full-item `LocalRect` width that goes through a `LayoutUnit` round trip when the item is length-adjusted.
- Glyph outlines exactly as Fontkit decodes them. TrueType contours are decoded directly from `glyf`, so off-curve start points, composite transforms, closing segments and two-decimal rounding all match.

Images:

- Decoding. AVIF uses dav1d with libyuv's BT.601 and BT.709 constants and bilinear chroma upsampling. WebP uses libwebp with its `(x·a·32897)>>23` premultiply. PNG and JPEG use Skia's rounded premultiply. On WebAssembly, AVIF is decoded by rav1d, the Rust port of dav1d, and WebP by the `image` crate's decoder, which is exact for lossless WebP (every packaged texture). The WebAssembly build produces the same bytes as the native one.
- Unpremultiply on readback and export is Skia's float pipeline with round-half-even.
- `drawImage`:
  - Chromium's default "low" smoothing: a nearest-mipmap level chosen from the geometric-mean scale, built with Skia's truncating 2×2/3×3 box filters. Sampling is Skia's legacy `SkBitmapProcState` with 4-bit bilinear weights and 32.32 fixed-point stepping restarted every 127 pixels.
  - The destination rectangle is rounded and not antialiased.
  - Blending uses the legacy `S32A_Opaque` and `SkBlendARGB32` blitters.
- Canvas masks. `destination-in` goes through Skia's highp pipeline. Luminance masks are converted with the original's JavaScript formula and `putImageData` premultiply.

Vector content:

- Filled paths use a port of Skia's analytic antialiasing (`SkScan_AAAPath`) together with its edge builder, analytic line/quad/cubic edges, curve chopping, convexity test, mask and run-length accumulators, and ARGB32 color blitters.
- Rectangles use Skia's `AntiFillRect`.
- Opacity on a single shape is folded into the paint alpha, as Chromium's paint-op optimizer does.
- SVG assets made of rectangles with solid or linear-gradient fills are rendered with the raster-pipeline gradient and the 8×8 ordered dither. Other SVG assets fall back to resvg.

## Remaining differences

- About 0.0003% of PNG pixels differ, on 100 of the 250 cards, always on the antialiased edges of a few glyphs.
  - The same glyph path rasterized by Skia m144 (`skia-python`) reproduces this port's coverage exactly, and so does Chromium's own output when the glyph sits elsewhere on the card.
  - Chromium differs only at particular positions. That points to a position-dependent step in its SVG image pipeline that was not identified.
  - The largest single difference is 55 levels on one edge pixel. None of this is visible at normal viewing size.
- Text stretched with `textLength` can place a glyph one `f32` step (about 0.000015 px) away from Chromium, from a different order of operations when the stretch is distributed. One of 50 fresh artwork cards (`97854941`, Valkyrie Sigrun) shows it, in 4 glyph positions of the outlined SVG; its PNG and rasterized SVG are pixel-identical.
- The PNG, JPEG and WebP container bytes differ from Chromium's encoders. The decoded pixels are what is compared. JPEG and WebP are lossy, and their encoders differ, so those outputs are close but not identical.
- Resized raster exports (`--width`, `--height`, `--scale` other than 1) use a bicubic resampler rather than Chromium's high-quality `drawImage` path. They were not part of the regression set.
- SVG assets that go beyond rectangles with solid or linear-gradient fills are rendered with resvg and are not bit-exact. The packaged template has none.
