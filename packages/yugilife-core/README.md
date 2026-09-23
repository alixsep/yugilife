# yugilife-core

Framework-independent template contracts, validation, and card rendering for YugiLife. Core ships
no card templates, template catalog, fonts, or card artwork assets.

```ts
import { exportCardToImage, exportCardToPng, exportCardToSvg, renderCard } from "yugilife-core"
import { DEFAULT_TEMPLATE } from "yugilife-templates"

const rendered = await renderCard(cardData, { templateBundle: DEFAULT_TEMPLATE })
const portableFromRender = await rendered.toSvg()
const pngFromRender = await rendered.toPng()
const webpFromRender = await rendered.toImage({
  format: "webp",
  quality: 0.9,
  size: { width: 1200 },
})
const portableSvg = await exportCardToSvg(cardData, { templateBundle: DEFAULT_TEMPLATE })
const png = await exportCardToPng(cardData, { scale: 2, templateBundle: DEFAULT_TEMPLATE })
const jpeg = await exportCardToImage(cardData, {
  backgroundColor: "#ffffff",
  format: "jpeg",
  size: { height: 1800 },
  templateBundle: DEFAULT_TEMPLATE,
})
```

Every render receives a complete `templateBundle`. Selecting, downloading, caching, or defaulting a
template belongs to the consumer. `yugilife-templates` is an optional sibling package containing the
official catalog; third-party consumers may supply an equivalent validated bundle.

The root entry point contains common rendering, contracts, layer-tree helpers, and validation.
Specialized APIs have explicit entry points:

```ts
import type { LayerRenderer } from "yugilife-core/advanced"
import { applyColorPreset } from "yugilife-core/color-grading"
```

## Card fields

A template declares every field it understands in `cardFields`, each with a
`kind`, `label`, optional constraints, and an optional `defaultValue`. A field is
required when `required` is true. Layers may only reference declared fields; a
layer pointing at an undeclared field fails validation at catalog build time.

Empty text, lists, numbers, and artwork are valid authored values unless a template declares a field
as `required`. Template presentation decides how empty content is displayed; core does not impose an
editor-specific required-field policy.

```ts
const card = createCardFromTemplate(template) // populated from declared defaults
validateCardData(card, template) // enforces kinds, ranges, options, and lengths
```

Because field metadata is data, an editor can generate its whole form from
`template.cardFields` rather than hardcoding one series' fields.

`maxLength` measures visible rich-text graphemes per rendered line. Use
`richTextLineLengths` for editor counters; do not apply the browser's native
`maxLength` to serialized rich-text inputs because it counts the markup itself.

## Layer tree

Layers form a tree; only `group` layers contain children. One traversal is
exported so consumers never re-implement recursion:

```ts
walkLayers(template.layers, ({ layer, ancestors }) => ...)
flattenLayers(template.layers) // groups included
flattenDrawableLayers(template.layers) // groups omitted
collectLayerGroups(template) // visibility UI, bucketed by `group`
defaultLayerVisibility(template)
collectPresetTargets(template)
defaultPresetForTarget(template, "frame")
```

## Supplying a template

`RenderOptions.templateBundle` is required and contains the template, manifest, base assets, and
color presets. `RenderOptions.assets` contains per-render additions or replacements and is merged
over the bundle assets. Core never resolves a template ID and never performs template downloads.

Templates own their ordered, discriminated layer list. The renderer preserves
that order as contiguous raster and vector render segments, so a raster layer
after text or SVG content composites above that vector content in both the live
preview and SVG export. Custom renderers declare exactly one `output` plane:
`"raster"`, `"vector"`, or `"container"`. A renderer that needs mixed output
must split it into separate ordered template layers. Raster renderers return `false` when they emit
no pixels; returning `true` or omitting the result means the declared output was emitted. Only
`false` suppresses the raster flush, so an empty custom renderer must return `false` explicitly.

Templates may use separate frame and border images, one combined
frame-and-border image, or a different decomposition. Custom raster or canvas
renderer names may be implemented through `RenderOptions.layerRenderers`.

Canvas masks may declare `coverageLayerId` to scope only their attenuation to
the rendered alpha of an earlier raster layer. An opaque source pixel receives
the authored mask value, a transparent source pixel leaves the target fully
opaque, and partial source alpha interpolates between them. This supports
artwork-aware material translucency without duplicating texture layers.

Artwork transforms contain only geometry plus an optional opaque `mode` string. An artwork layer
may declare a matching `transformMode`; core gates the layer by string equality but assigns no
meaning to either value. Product concepts such as full-art editing belong to the template and app,
which select a mode and give each mode-gated layer its own clipping region.

Text layers can wrap serialized field or semantic values with rich-text source
fragments. `prefix` is prepended and `suffix` is appended before parsing, which
allows dynamic values to use tags such as `<scale>`:

```json
{
  "prefix": "<scale x=\"1.25\">",
  "suffix": "</scale>"
}
```

Empty values produce no wrapper fragments.

`<sup>...</sup>` and `<sub>...</sub>` provide same-font superscript and
subscript text. They reduce the inline font size and emit SVG baseline
alignment, so ASCII text can be raised or lowered without depending on
Unicode superscript glyphs.

Semantic presentation rules may also declare `layerOptions` to sparsely override
renderer options on an existing raster or canvas layer. The resolved options are
merged over the layer's declared options, so one bevel layer can use different
colors for different semantic frames without duplicating the layer:

```json
{
  "layerOptions": {
    "outerBevel": { "highlightColor": "#fff0f052" }
  }
}
```

Bevel `highlightOpacity` and `shadowOpacity` options are optional and default to
`1`; alpha can therefore be kept in the color itself with an `#RRGGBBAA` value.
Legacy numeric opacity options remain supported. Colors, opacity, typography,
geometry, and semantic asset choices belong to template data. SVG export serializes each raster segment as an encoded `<image>`
and retains vector segments in their declared order.

## SVG text portability

`exportCardToSvg` defaults `SvgExportOptions.textMode` to `"paths"`. The browser
performs the final SVG text layout using the loaded template fonts, then Fontkit
replaces every rendered grapheme with its font outline at the browser-measured
position. The resulting file has no live `<text>` or `<tspan>` elements and does
not depend on fonts installed on the machine that opens it.

Path export deliberately fails if a rendered font has no declared
`fontAssetId`, or if that font lacks a required glyph; it never silently bakes a
system-font fallback into an otherwise portable document. Use
`{ textMode: "text" }` only when selectable, font-dependent SVG text is wanted.
`await rendered.toSvg()` follows the same path-default policy. SVG serialization
is asynchronous because portable output may need to load and parse source fonts;
pass `{ textMode: "text" }` explicitly for live SVG text.

Exported SVG roots identify the policy with
`data-yugilife-text-mode="paths|text"`. Every raster segment embedded inside an
SVG remains a lossless PNG `<image>` because segments may require transparency;
text remains vector path data rather than pixels.

Raster export uses that same portable outlined composition. `toImage()` and `exportCardToImage()`
support PNG, JPEG, and WebP; PNG is the lossless default. Output remains at the template's native
dimensions unless `size` supplies one positive scale, pixel width, or pixel height. Width and height
requests preserve the template aspect ratio. JPEG/WebP quality defaults to `0.92`; JPEG transparency
is composited over white unless `backgroundColor` supplies an opaque hex RGB matte. The encoder
rejects unsupported browser-format fallback and raster outputs above its documented safety budget.
Outputs smaller than the template are first rasterized at native size and then downsampled with the
browser's high-quality smoothing preference; native and enlarged outputs rasterize the SVG directly
at their target size so vector content remains sharp.
`toPng()` and `exportCardToPng()` remain compatibility wrappers whose positive `scale` multiplies
the native dimensions.

React UI belongs to `apps/yugilife`; core does not import or depend on React.

## Cancellation and shared resources

Pass an `AbortSignal` through `RenderOptions.signal` to stop a render. An already
aborted signal rejects before template work begins. During rendering, the signal
is checked before and after every asynchronous layer and again before a result is
returned. Custom layer renderers receive the same signal and should pass it to
their own cancellable work.

Image and font loads are shared between overlapping renders. Aborting one render
rejects only that render's wait; the default `abort()` reason is a DOM
`AbortError`, while an explicit `abort(reason)` propagates that exact reason. It
does not cancel or evict a load still needed by another render. Failed shared
loads are evicted so a later render can retry. Successful URL caches are
bounded, while Blob, drawable, document-font, and texture caches use weak
ownership where possible.
