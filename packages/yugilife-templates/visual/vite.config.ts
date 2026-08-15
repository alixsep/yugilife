import path from "node:path"
import { fileURLToPath } from "node:url"

import { defineConfig } from "vite"

import { yugilifeLosslessWebp } from "../scripts/lossless-webp.mjs"
import { yugilifeWoff2 } from "../scripts/woff2.mjs"

const fixtureDirectory = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: fixtureDirectory,
  plugins: [yugilifeLosslessWebp(), yugilifeWoff2()],
  resolve: {
    alias: {
      "yugilife-core": path.resolve(fixtureDirectory, "../../yugilife-core/src/index.ts"),
    },
  },
  server: {
    port: 4174,
  },
})
