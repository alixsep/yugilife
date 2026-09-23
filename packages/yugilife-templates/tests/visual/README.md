# Series 10 visual regression

The real-card fixtures render 25 named English TCG cards at the native 813 × 1185 dimensions in the
pinned Playwright Chromium browser. Each fixture keeps one JSON card definition, its selected
printing metadata, and the supplied local artwork under `fixtures/`; the browser fixture discovers
them through Vite and never depends on a remote image request. The card data, artwork, bundled fonts,
template, and layer visibility are deterministic.

The real-card suite covers all seven base monster frames, all six Pendulum-capable monster frame
combinations, every Spell/Trap subtype icon, both Link layouts, and long-name/effect typography
cases. Each artwork uses the matching kebab-case fixture ID as its basename, retaining only its
original image extension. The remaining synthetic cases deliberately exercise renderer-specific masks, geometry, and
rich-text export paths that are not naturally isolated by a real card. Baseline names include the
Playwright project and operating-system name because browser text and canvas rasterization can vary
across platforms. The committed baselines are canonical Chromium-on-Linux artifacts. Direct visual
commands fail early on other platforms rather than creating unreviewed local baselines; use root
`pnpm check:portable` there and leave authoritative visual comparison to Linux/CI.

The real-card JSON records the card database ID and selected TCG set code so a fixture cannot silently
change printings while retaining the same screenshot name. Card fields are copied into the published
Series 10 contract; `language` is intentionally absent because Series 10 has no standalone language
rendering input.

Every case renders into one page per Playwright worker rather than reloading the harness for each
of them. A reload re-fetched the template, re-registered its fonts and re-graded its textures to
change nothing but the card data, which is why the suite spent most of its time on setup instead of
rendering. Cases stay independent because a render depends only on the card it is given; the shared
page is set up once and then draws card after card, exactly as the application does. The baselines
are rendered with prepared textures for the same reason — that is what the application draws with
once a template is active. `?prepared=false` keeps the live grading path reachable, and one case
uses it so that path cannot rot.

`Series 10 prepared textures hold exactly the graded pixels` compares each prepared texture against
grading the same region in the browser then and there. The screenshots cannot make that claim on
their own, because a texture is mostly covered by the layers drawn over it; this case is what keeps
the stored form honest.

The comparison is pixel-exact: `maxDiffPixels` and Playwright's per-pixel color `threshold` are
both set to `0`. Baselines use Playwright 1.62.0's lossless WebP snapshot support. Any pixel
inconsistency fails the test. Because this is intentionally strict, authoritative comparisons
must use the pinned Chromium-on-Linux environment described above.
Visual cases run fully parallel with four Playwright workers by default, including snapshot-update
runs; each worker owns one browser context and one loaded fixture page, and they share the read-only
Vite fixture server.

Regenerate the committed baseline deliberately with:

```sh
pnpm --filter yugilife-templates test:visual:update
```
