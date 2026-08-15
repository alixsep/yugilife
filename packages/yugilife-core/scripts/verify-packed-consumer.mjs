import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { x as extractTar } from "tar"

import { runCommand } from "../../../scripts/run-command.mjs"

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const suppliedTarball = process.argv[2]
let interruptedSignal
const interruption = new AbortController()

async function run(command, arguments_, cwd, label, quiet = false) {
  await runCommand(command, arguments_, {
    cwd,
    label,
    quiet,
    signal: interruption.signal,
    timeoutMs: 300_000,
  })
}

const handleSignal = (signal) => {
  if (interruptedSignal) return
  interruptedSignal = signal
  interruption.abort(new Error(`Packed-consumer verification interrupted by ${signal}.`))
}
const interrupt = () => handleSignal("SIGINT")
const terminate = () => handleSignal("SIGTERM")
process.on("SIGINT", interrupt)
process.on("SIGTERM", terminate)

const consumerDirectory = await mkdtemp(path.join(os.tmpdir(), "yugilife-core-consumer-"))
const installedPackage = path.join(consumerDirectory, "node_modules/yugilife-core")
let failure
try {
  let tarball = suppliedTarball ? path.resolve(suppliedTarball) : undefined
  if (!tarball) {
    const packDirectory = path.join(consumerDirectory, "packed")
    await mkdir(packDirectory)
    await run(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["pack", "--pack-destination", packDirectory],
      packageDirectory,
      "packed-consumer: pack core",
      true,
    )
    const tarballs = (await readdir(packDirectory)).filter((file) => file.endsWith(".tgz"))
    if (tarballs.length !== 1) {
      throw new Error(`Expected one packed core tarball, found ${tarballs.length}.`)
    }
    tarball = path.join(packDirectory, tarballs[0])
  }
  await mkdir(installedPackage, { recursive: true })
  console.log("[packed-consumer: extract package]")
  await extractTar({
    cwd: installedPackage,
    file: tarball,
    preservePaths: false,
    strict: true,
    strip: 1,
  })
  await writeFile(
    path.join(consumerDirectory, "package.json"),
    '{"name":"core-consumer-smoke","private":true,"type":"module"}\n',
  )
  await writeFile(
    path.join(consumerDirectory, "consumer.mjs"),
    [
      'import { exportCardToPng, renderCard } from "yugilife-core"',
      'import { applyColorPreset } from "yugilife-core/color-grading"',
      "",
      'if (typeof renderCard !== "function") throw new Error("Missing root renderer")',
      'if (typeof exportCardToPng !== "function") throw new Error("Missing PNG exporter")',
      'if (typeof applyColorPreset !== "function") throw new Error("Missing color grading")',
      "",
    ].join("\n"),
  )
  await writeFile(
    path.join(consumerDirectory, "consumer.ts"),
    [
      'import { exportCardToPng, renderCard, type CardData, type CardTemplate, type PngExportOptions } from "yugilife-core"',
      'import type { LayerRenderer } from "yugilife-core/advanced"',
      'import { applyColorPreset, type ColorPreset } from "yugilife-core/color-grading"',
      "",
      'const card: CardData = { name: "External consumer" }',
      "const template: CardTemplate | undefined = undefined",
      "const renderer: LayerRenderer | undefined = undefined",
      'const preset: ColorPreset = { method: "identity" }',
      "const pngOptions: PngExportOptions = { scale: 2 }",
      "void template",
      "void renderer",
      "void applyColorPreset",
      "void renderCard",
      "void exportCardToPng",
      "void pngOptions",
      "void preset",
      "",
    ].join("\n"),
  )
  await run(
    process.execPath,
    ["consumer.mjs"],
    consumerDirectory,
    "packed-consumer: verify JavaScript imports",
  )
  await run(
    process.execPath,
    [
      path.join(packageDirectory, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--strict",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "--lib",
      "ES2022,DOM",
      "consumer.ts",
    ],
    consumerDirectory,
    "packed-consumer: verify TypeScript declarations",
  )
  console.log("Verified packed root, advanced, and color-grading imports from an external consumer")
} catch (error) {
  failure = error
} finally {
  process.off("SIGINT", interrupt)
  process.off("SIGTERM", terminate)
  await rm(consumerDirectory, { force: true, recursive: true })
}

if (interruptedSignal) {
  console.error(
    `Packed-consumer verification interrupted by ${interruptedSignal}; temporary files removed.`,
  )
  process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143
} else if (failure) {
  throw failure
}
