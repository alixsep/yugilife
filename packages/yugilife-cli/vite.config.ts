import path from "node:path"
import { fileURLToPath } from "node:url"

import { defineConfig } from "vite"

const packageDirectory = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: path.join(packageDirectory, "dist/browser"),
    rollupOptions: {
      external: ["yugilife-core"],
      input: path.join(packageDirectory, "src/browser/entry.ts"),
      output: {
        entryFileNames: "renderer.js",
        format: "es",
      },
    },
    sourcemap: false,
  },
})
