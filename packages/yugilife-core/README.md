# yugilife-core

Yugilife's card renderer for JavaScript: templates and card data in; validation, semantics,
presentation, rich text, and SVG, PNG, JPEG, or WebP out.

The implementation is the Rust renderer in [`crates/`](../../crates), compiled to WebAssembly. Importing
the package loads it once; after that the validation, semantics, presentation, rich-text, and
layer-tree functions are synchronous, and rendering runs in a Web Worker. The same renderer runs
natively as [`yugilife-cli`](../../crates/yugilife-cli), and both produce the same bytes.

```ts
import { createCardFromTemplate, exportCardToImage } from "yugilife-core"

const card = { ...createCardFromTemplate(bundle.template), name: "Blue-Eyes White Dragon" }
const png = await exportCardToImage(card, { templateBundle: bundle, format: "png" })
```

`pnpm --filter yugilife-core build` builds the module from `crates/yugilife-wasm` (Rust with the
`wasm32-wasip1` target). [`crates/docs/WASM.md`](../../crates/docs/WASM.md) describes the build, the
module's interface, and how it renders in the browser.
