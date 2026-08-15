import { access, readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

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

await Promise.all([
  access(path.join(distributionDirectory, "index.js")),
  access(path.join(distributionDirectory, "fontkit-runtime.js")),
  access(path.join(distributionDirectory, "index.d.ts")),
  access(path.join(distributionDirectory, "advanced.js")),
  access(path.join(distributionDirectory, "advanced.d.ts")),
  access(path.join(distributionDirectory, "color-grading.js")),
  access(path.join(distributionDirectory, "public/color-grading.d.ts")),
])

const files = await walk(distributionDirectory)
if (files.some((file) => file.endsWith(".map"))) {
  throw new Error("Core distribution contains forbidden source-map files.")
}
if (
  files.some(
    (file) =>
      file.includes(`${path.sep}references${path.sep}`) || file.endsWith("chromapair-config.json"),
  )
) {
  throw new Error("Development-only template authoring input was copied into core.")
}

const javascript = await readFile(path.join(distributionDirectory, "index.js"), "utf8")
const allJavascript = (
  await Promise.all(
    files.filter((file) => file.endsWith(".js")).map((file) => readFile(file, "utf8")),
  )
).join("\n")
if (javascript.length < 1_000 || !javascript.includes("renderCard")) {
  throw new Error("Core JavaScript entry is missing its public renderer exports.")
}
if (allJavascript.includes("yugilife-templates")) {
  throw new Error("Core distribution contains a runtime reference to yugilife-templates.")
}
if (/(?:from\s*|require\()["']react(?:\/|["'])/.test(allJavascript)) {
  throw new Error("Core distribution contains a React runtime import.")
}
if (/data:(?:image|font)\//.test(allJavascript)) {
  throw new Error("Core JavaScript entry contains an embedded image or font data URL.")
}

const packageManifest = JSON.parse(
  await readFile(path.join(packageDirectory, "package.json"), "utf8"),
)
if (packageManifest.dependencies?.["yugilife-templates"]) {
  throw new Error("yugilife-templates must not be a runtime dependency of yugilife-core.")
}
for (const dependencyGroup of ["dependencies", "devDependencies", "peerDependencies"]) {
  for (const dependency of Object.keys(packageManifest[dependencyGroup] ?? {})) {
    if (
      dependency === "react" ||
      dependency === "react-dom" ||
      dependency.startsWith("@types/react")
    ) {
      throw new Error(`Core package retains forbidden React dependency "${dependency}".`)
    }
  }
}

console.log("Verified template-free core package")
