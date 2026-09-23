import { execFileSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"

import mdx from "@mdx-js/rollup"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

import { yugilifeLosslessWebp } from "../../packages/yugilife-templates/scripts/lossless-webp.mjs"
import { yugilifeWoff2 } from "../../packages/yugilife-templates/scripts/woff2.mjs"

import { workspaceAliases } from "./workspace-aliases"

import type { Dirent } from "node:fs"

const commitPattern = /^[a-f0-9]{40}$/
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url))
const blogContentDirectory = fileURLToPath(new URL("./src/content/blog/", import.meta.url))

function resolveBlogPublicationCommits() {
  const commits: Record<string, string> = {}
  let directories: Dirent[]
  try {
    directories = readdirSync(blogContentDirectory, { withFileTypes: true })
  } catch {
    return commits
  }
  for (const directory of directories) {
    if (!directory.isDirectory() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(directory.name)) continue
    const metadataPath = `apps/yugilife/src/content/blog/${directory.name}/metadata.ts`
    try {
      const commit = execFileSync(
        "git",
        ["log", "--first-parent", "--follow", "--diff-filter=A", "--format=%H", "--", metadataPath],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      )
        .trim()
        .split("\n", 1)[0]
        ?.toLowerCase()
      if (commit && commitPattern.test(commit)) commits[directory.name] = commit
    } catch {
      // Source archives and not-yet-committed posts have no publication history to expose.
    }
  }
  return commits
}

export default defineConfig(({ mode }) => ({
  // GitHub Pages hosts this project below the repository name. Hash routing keeps every
  // client-side route on this one real server path, so refreshing /build or /inventory never
  // depends on a Pages-specific 404 fallback.
  base: mode === "pages" ? "/yugilife/" : "/",

  define: {
    __YUGILIFE_BLOG_PUBLICATION_COMMITS__: JSON.stringify(resolveBlogPublicationCommits()),
  },

  // Resolve core to its TypeScript sources so the bundler and `tsc` share one import graph.
  resolve: {
    alias: workspaceAliases,
  },

  // The card-catalog worker loads Brotli only when a catalog is opened. Pre-bundle it at
  // dev-server startup so Vite does not discover it late and force a page refresh immediately
  // after the first catalog download.
  optimizeDeps: {
    include: ["brotli-wasm"],
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
