import mdx from "@mdx-js/rollup"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

import { yugilifeLosslessWebp } from "../../packages/yugilife-templates/scripts/lossless-webp.mjs"
import { yugilifeWoff2 } from "../../packages/yugilife-templates/scripts/woff2.mjs"

import { workspaceAliases } from "./workspace-aliases"

export default defineConfig(({ mode }) => ({
  // GitHub Pages hosts this project below the repository name. Hash routing keeps every
  // client-side route on this one real server path, so refreshing /build or /inventory never
  // depends on a Pages-specific 404 fallback.
  base: mode === "pages" ? "/yugilife/" : "/",

  // Resolve core to its TypeScript sources so the bundler and `tsc` share one import graph.
  resolve: {
    alias: workspaceAliases,
  },

  plugins: [
    yugilifeLosslessWebp(),
    yugilifeWoff2(),
    {
      ...mdx(),
      enforce: "pre",
    },
    react(),
    tailwindcss(),
  ],

  server: {
    // Enable if you want to host on your local network. (useful for testing)
    // host: true,
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },

  preview: {
    port: 4173,
    strictPort: true,
  },
}))
