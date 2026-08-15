import { access, readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { loadCatalog, packageDirectory } from "./catalog.mjs"

const distributionDirectory = path.join(packageDirectory, "dist")

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const resolved = path.join(directory, entry.name)
        return entry.isDirectory() ? walk(resolved) : [resolved]
      }),
    )
  ).flat()
}

const catalog = await loadCatalog()
await Promise.all([
  access(path.join(distributionDirectory, "index.js")),
  access(path.join(distributionDirectory, "index.d.ts")),
  access(path.join(distributionDirectory, "node.js")),
  access(path.join(distributionDirectory, "node.d.ts")),
])

const files = await walk(distributionDirectory)
if (files.some((file) => file.endsWith(".map"))) {
  throw new Error("Template distribution contains forbidden source-map files.")
}
if (
  files.some(
    (file) =>
      file.includes(`${path.sep}references${path.sep}`) ||
      file.includes(`${path.sep}reports${path.sep}`) ||
      file.endsWith("chromapair-config.json"),
  )
) {
  throw new Error("Template distribution contains development-only authoring material.")
}
for (const file of files.filter((candidate) => candidate.endsWith(".webp"))) {
  const header = await readFile(file)
  if (
    header.subarray(0, 4).toString("ascii") !== "RIFF" ||
    header.subarray(8, 12).toString("ascii") !== "WEBP" ||
    header.subarray(12, 16).toString("ascii") !== "VP8L"
  ) {
    throw new Error(`Template distribution contains a non-lossless WebP asset: "${file}".`)
  }
}

const nodeEntry = await import(
  `${pathToFileURL(path.join(distributionDirectory, "node.js")).href}?verify=${Date.now()}`
)
const bundle = await nodeEntry.loadInstalledTemplate()
if (bundle.manifest.id !== nodeEntry.DEFAULT_TEMPLATE_ID) {
  throw new Error("Packaged default template identity is inconsistent.")
}
if (Object.keys(bundle.assets).length === 0) {
  throw new Error("Packaged default template has no runtime assets.")
}
if (catalog.length !== nodeEntry.PACKAGED_TEMPLATES.length) {
  throw new Error("Runtime template catalog does not match the authoring catalog.")
}

console.log(`Verified ${catalog.length} packaged templates and ${files.length} runtime files`)
