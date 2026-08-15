import path from "node:path"
import { fileURLToPath } from "node:url"

import { defineConfig } from "vite"

import { yugilifeLosslessWebp } from "./scripts/lossless-webp.mjs"
import { yugilifeWoff2 } from "./scripts/woff2.mjs"

const packageDirectory = path.dirname(fileURLToPath(import.meta.url))

function templateAssetFileName(originalFileNames: readonly string[]) {
  for (const original of originalFileNames) {
    const normalized = original.replaceAll("\\", "/")
    const marker = "/yugilife-templates/"
    const markerIndex = normalized.lastIndexOf(marker)
    if (markerIndex >= 0) return `assets/${normalized.slice(markerIndex + marker.length)}`
  }
  return undefined
}

export default defineConfig({
  base: "./",
  plugins: [yugilifeLosslessWebp(), yugilifeWoff2()],
  build: {
    assetsInlineLimit: 0,
    emptyOutDir: true,
    lib: false,
    rollupOptions: {
      external: [/^node:/u, "yugilife-core"],
      input: {
        index: path.join(packageDirectory, "src/index.ts"),
        node: path.join(packageDirectory, "src/node.ts"),
      },
      output: {
        assetFileNames: (assetInfo) =>
          templateAssetFileName(assetInfo.originalFileNames) ??
          "assets/runtime/[name]-[hash][extname]",
        chunkFileNames: "_chunks/[name]-[hash].js",
        entryFileNames: "[name].js",
        format: "es",
      },
      preserveEntrySignatures: "strict",
    },
    sourcemap: false,
  },
})
