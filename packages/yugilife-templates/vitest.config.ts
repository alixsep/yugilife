import path from "node:path"
import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

import { yugilifeLosslessWebp } from "./scripts/lossless-webp.mjs"
import { yugilifeWoff2 } from "./scripts/woff2.mjs"

const packageDirectory = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [yugilifeLosslessWebp(), yugilifeWoff2()],
  resolve: {
    alias: {
      "yugilife-core": path.resolve(packageDirectory, "../yugilife-core/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
})
