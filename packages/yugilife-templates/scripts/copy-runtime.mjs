import { cp, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { loadCatalog, packageDirectory } from "./catalog.mjs"
import { convertToLosslessWebp } from "./lossless-webp.mjs"
import { convertToWoff2 } from "./woff2.mjs"

const entries = await loadCatalog()
const runtimeArtifacts = new Map(
  entries.flatMap((entry) =>
    entry.runtimeArtifacts.map((artifact) => [artifact.relative, artifact]),
  ),
)

await Promise.all(
  [...runtimeArtifacts.values()].map(async (artifact) => {
    const destination = path.join(packageDirectory, "dist/assets", artifact.relative)
    await mkdir(path.dirname(destination), { recursive: true })
    if (artifact.source) {
      if (artifact.losslessWebp) {
        await writeFile(destination, await convertToLosslessWebp(artifact.source))
      } else if (artifact.woff2) {
        await writeFile(destination, await convertToWoff2(artifact.source))
      } else {
        await cp(artifact.source, destination)
      }
    } else {
      await writeFile(destination, `${JSON.stringify(artifact.json, null, 2)}\n`)
    }
  }),
)

console.log(`Copied ${runtimeArtifacts.size} runtime files for ${entries.length} templates`)
