// The official templates embedded in the Rust command line (crates/yugilife-cli/templates): the
// authoring catalog plus the built runtime templates and shared assets from dist/assets.
//
//   node scripts/cli-templates.mjs          write the embedded copy from the current build
//   node scripts/cli-templates.mjs --check  fail when the embedded copy differs from the build
//
// The package build runs the check, so a template change cannot ship with a stale CLI copy; only
// the explicit command writes it.
import { existsSync } from "node:fs"
import { cp, mkdir, readdir, readFile, rename, rm } from "node:fs/promises"
import path from "node:path"

import { packageDirectory } from "./paths.mjs"

const checkOnly = process.argv.includes("--check")
const repository = path.resolve(packageDirectory, "../..")
const destination = path.join(repository, "crates/yugilife-cli/templates")
const assets = path.join(packageDirectory, "dist/assets")
const sources = [
  ["catalog.json", path.join(packageDirectory, "catalog.json")],
  ["templates", path.join(assets, "templates")],
  ["shared", path.join(assets, "shared")],
]

async function files(root, relative = "") {
  const directory = path.join(root, relative)
  const entries = await readdir(directory, { withFileTypes: true })
  const found = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = path.posix.join(relative, entry.name)
    if (entry.isDirectory()) found.push(...(await files(root, child)))
    else found.push(child)
  }
  return found
}

/** Relative path -> bytes for everything the embedded copy should contain. */
async function expected() {
  const contents = new Map()
  for (const [name, source] of sources) {
    if (!existsSync(source)) {
      throw new Error(
        `${path.relative(repository, source)} is missing; build yugilife-templates first.`,
      )
    }
    if (name.endsWith(".json")) {
      contents.set(name, await readFile(source))
    } else {
      for (const file of await files(source)) {
        contents.set(path.posix.join(name, file), await readFile(path.join(source, file)))
      }
    }
  }
  return contents
}

async function differences(wanted) {
  const present = existsSync(destination) ? await files(destination) : []
  const problems = []
  for (const file of present) {
    if (!wanted.has(file)) problems.push(`unexpected ${file}`)
  }
  for (const [file, bytes] of wanted) {
    const target = path.join(destination, file)
    if (!existsSync(target)) problems.push(`missing ${file}`)
    else if (!(await readFile(target)).equals(bytes)) problems.push(`changed ${file}`)
  }
  return problems
}

const wanted = await expected()
const problems = await differences(wanted)
if (checkOnly) {
  if (problems.length > 0) {
    throw new Error(
      `The Rust CLI's embedded templates (crates/yugilife-cli/templates) are stale:\n  ${problems.join("\n  ")}\n` +
        "Run `pnpm --filter yugilife-templates generate:cli-templates` and review the change.",
    )
  }
  console.log(`Verified the Rust CLI's ${wanted.size} embedded template files`)
} else if (problems.length === 0) {
  console.log("The Rust CLI's embedded templates are current")
} else {
  // Stage the complete copy beside the destination, then swap it in.
  const staging = `${destination}.staging`
  await rm(staging, { force: true, recursive: true })
  await mkdir(staging, { recursive: true })
  for (const [name, source] of sources) {
    await cp(source, path.join(staging, name), { recursive: true })
  }
  await rm(destination, { force: true, recursive: true })
  await rename(staging, destination)
  console.log(`Updated the Rust CLI's embedded templates:\n  ${problems.join("\n  ")}`)
}
