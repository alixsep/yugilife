import path from "node:path"
import { fileURLToPath } from "node:url"

import { defineConfig } from "vite"

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: {
        advanced: path.join(sourceDirectory, "src/advanced.ts"),
        "color-grading": path.join(sourceDirectory, "src/public/color-grading.ts"),
        index: path.join(sourceDirectory, "src/index.ts"),
      },
      preserveEntrySignatures: "strict",

      output: {
        chunkFileNames: "_chunks/[name]-[hash].js",
        entryFileNames: "[name].js",

        assetFileNames: "assets/runtime/[name]-[hash][extname]",
      },
    },

    sourcemap: false,
    emptyOutDir: true,
  },
})
