# yugilife-templates

Official YugiLife template catalog, authoring sources, and generated runtime distribution. Template
definitions and their assets share one lifecycle here; there is intentionally no separate asset
package.

`catalog.json` is the explicit publication policy. `bundledTemplates` is the allow-list for runtime
artifacts, and `defaults` selects product recommendations from that allow-list. A manifest must have
`status: "supported"` before it can be distributed. Experimental and disabled manifests remain
authoring material.

Each supported template lives below `templates/<category>/<name>` and owns a
`manifest.json`, a category-specific `template.json`, template-local runtime
assets, and any development-only references or generation configuration. Canonical shared runtime
sources may be declared by a template manifest when they belong to a reusable asset family. Paths in manifests are
relative to the template directory. Cross-template relationships use stable
template IDs, never filesystem paths.

The Series 10 canonical frame sources are `shared/frame-texture.png`,
`shared/link-texture.png`, and `shared/xyz-texture.png`. The template manifest
maps them to Series 10 asset IDs, and Chromapair configuration resolves those
same sources relative to the template directory.

Only assets a layer actually references enter the runtime distribution. A declared but unreferenced
asset produces a build warning and is excluded, so an unused font never reaches consumers.

`references/` is one flat, development-only directory per template. Its contents
are comparison and color-grading source material; they are never published or bundled into the
application. The app's reference library starts empty and
the user loads their own images at runtime.

The browser entry exports lightweight catalog descriptors and explicit progress-aware loaders. Its
`DEFAULT_TEMPLATE` contains fetchable asset URLs for direct consumers; `DEFAULT_TEMPLATE.load()`
prefetches those assets into a complete Blob-backed bundle and reports byte progress. The `./node`
entry performs no network requests and reads only assets installed with this package.

The current MVP supports only `card/series-10`. The other category directories
reserve the intended catalog shape; they do not claim support and contain no
placeholder manifests.

## Template categories

- `card` describes one independently rendered card.
- `box` will describe printable deck-box sheets, panels, folds, cuts, bleed, and
  glue tabs.
- `playmat/field` will describe an independently renderable, reusable zone
  layout.
- `playmat/board` will describe a complete printable composition, including
  artwork, bleed, trim, and placements of fields.

A board may depend on one or more fields by stable template ID and may transform,
mirror, or rotate each placement. A field never depends on a particular board.

## Color presets

From the repository root, run `pnpm generate:assets`. The generator discovers template-local
`chromapair-config.json` files and invokes the pinned Chromapair version through `uvx`. It evaluates
every template into a temporary staging directory before replacing any committed
`color-presets.json`; reports and intermediate textures remain development-only.

Each committed preset collection has a `color-presets.provenance.json` recording the exact generator
version and SHA-256 hashes of its configuration, source texture, calibration references, and output.
`pnpm check:generated` verifies this record without invoking `uvx` or accessing the network. This
separates an intentionally mutating, externally tooled calibration workflow from fast deterministic
checks while still making every stale input or hand-edited output fail normal verification.
