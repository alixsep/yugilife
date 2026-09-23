# Artwork mask workers

This app-owned directory contains the checked-in C/WASM kernels and two independent module workers.

- `quick-selection-worker` owns a prepared 768px segmentation graph. It accepts native artwork and
  pins, refines coverage, expands it to native dimensions, and encodes the manual mask PNG off the UI
  thread. Each refinement restores the graph baseline so split-heavy edits do not accumulate memory.
- `artwork-mask-worker` owns one decoded source and a reusable WASM instance. It caches immutable
  alpha coverage and a lazy 7×7 smoothed plane, applies optional chamfer glow, encodes a native PNG,
  and returns a bounded 1024px preview. Its current kernels are `mask_alpha_smooth` and
  `mask_alpha_glow`; the original RGBA kernel remains a regression reference.

Live effects keep at most one active job and one queued intent. Save/export/recovery effects use a
separate FIFO with one operation worker, released on completion or failure. A failed preview worker
can be recreated, and closing the editor does not cancel independent durable operations.

The store invalidates manual coverage synchronously when points change. Completion must match the
exact artwork and points identities. Save and all exports reject incomplete active dot masks; only
the live preview may retain a previous completed frame while replacement work runs. Failures have
explicit retry controls. Source selection and completion policy live in the editor model, and shared
alpha resampling lives here in `resample-alpha.ts`.

Effects are sparse editor-document intent. Derived pixels and effects PNGs are transient. Core
receives resolved mask images and owns generic placement, clipping, and composition. It does not
import this worker, the editor, or database identities. The workspace retains bounded pixel refs
plus small revision counters, rather than native RGBA arrays in React state.

The artifact has a 128 MiB WASM ceiling. Rebuild it only when changing C kernels:

```sh
pnpm --filter yugilife build:pin-mask
```

This requires clang and wasm-ld. Normal app builds consume the checked-in WASM without a compiler.
