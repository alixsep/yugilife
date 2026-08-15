import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { runCommand } from "../../../scripts/run-command.mjs"

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const coreDirectory = path.resolve(packageDirectory, "../yugilife-core")
const templatesDirectory = path.resolve(packageDirectory, "../yugilife-templates")
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
const registry = process.env.YUGILIFE_NPM_REGISTRY
const interruption = new AbortController()
let interruptedSignal

async function run(command, arguments_, cwd, label, quiet = false) {
  await runCommand(command, arguments_, {
    cwd,
    label,
    quiet,
    signal: interruption.signal,
    timeoutMs: 300_000,
  })
}

function handleSignal(signal) {
  if (interruptedSignal) return
  interruptedSignal = signal
  interruption.abort(new Error(`Packed CLI verification interrupted by ${signal}.`))
}

async function packPackage(packagePath, destination, label) {
  await mkdir(destination)
  await run(
    packageManager,
    ["pack", "--pack-destination", destination],
    packagePath,
    `${label}: pack`,
    true,
  )
  const tarballs = (await readdir(destination)).filter((file) => file.endsWith(".tgz"))
  if (tarballs.length !== 1) {
    throw new Error(`Expected one ${label} tarball, found ${tarballs.length}.`)
  }
  return path.join(destination, tarballs[0])
}

function localPackageSpec(tarball, consumerDirectory) {
  const relativePath = path.relative(consumerDirectory, tarball).split(path.sep).join("/")
  return `file:./${relativePath}`
}

const interrupt = () => handleSignal("SIGINT")
const terminate = () => handleSignal("SIGTERM")
process.on("SIGINT", interrupt)
process.on("SIGTERM", terminate)

const consumerDirectory = await mkdtemp(path.join(os.tmpdir(), "yugilife-cli-consumer-"))
let failure
try {
  const coreTarball = await packPackage(
    coreDirectory,
    path.join(consumerDirectory, "packed-core"),
    "packed-consumer: core",
  )
  const cliTarball = await packPackage(
    packageDirectory,
    path.join(consumerDirectory, "packed-cli"),
    "packed-consumer: cli",
  )
  const templatesTarball = await packPackage(
    templatesDirectory,
    path.join(consumerDirectory, "packed-templates"),
    "packed-consumer: templates",
  )
  await writeFile(
    path.join(consumerDirectory, "package.json"),
    JSON.stringify(
      {
        name: "yugilife-cli-consumer-smoke",
        private: true,
        type: "module",
        dependencies: {
          "yugilife-cli": localPackageSpec(cliTarball, consumerDirectory),
          "yugilife-core": localPackageSpec(coreTarball, consumerDirectory),
          "yugilife-templates": localPackageSpec(templatesTarball, consumerDirectory),
        },
      },
      null,
    ) + "\n",
  )
  await writeFile(
    path.join(consumerDirectory, "pnpm-workspace.yaml"),
    `overrides:\n  yugilife-core: ${localPackageSpec(coreTarball, consumerDirectory)}\n  yugilife-templates: ${localPackageSpec(templatesTarball, consumerDirectory)}\n`,
  )
  await run(
    packageManager,
    [
      "install",
      "--ignore-scripts",
      "--no-frozen-lockfile",
      ...(registry === undefined ? [] : ["--registry", registry]),
    ],
    consumerDirectory,
    "packed-consumer: install",
    false,
  )

  const installedCli = path.join(consumerDirectory, "node_modules/yugilife-cli")
  const inputPath = path.join(consumerDirectory, "card.json")
  const jpegOutputPath = path.join(consumerDirectory, "card.jpg")
  const pngOutputPath = path.join(consumerDirectory, "card.png")
  const svgOutputPath = path.join(consumerDirectory, "card.svg")
  const webpOutputPath = path.join(consumerDirectory, "card.webp")
  const installedBin = path.join(
    consumerDirectory,
    process.platform === "win32"
      ? "node_modules/.bin/yugilife-cli.cmd"
      : "node_modules/.bin/yugilife-cli",
  )
  await access(path.join(installedCli, "dist/cli.js"))
  await access(installedBin)
  await writeFile(inputPath, '{"card":{"cardVariant":"effect","name":"Packed consumer"}}\n')
  const executable = process.platform === "win32" ? process.execPath : installedBin
  const executableArguments =
    process.platform === "win32" ? [path.join(installedCli, "dist/cli.js")] : []
  await run(
    executable,
    [...executableArguments, "doctor"],
    consumerDirectory,
    "packed-consumer: doctor",
  )
  await run(
    executable,
    [...executableArguments, "render", inputPath, "--output", svgOutputPath],
    consumerDirectory,
    "packed-consumer: render SVG",
  )
  let svg
  try {
    svg = await readFile(svgOutputPath, "utf8")
  } catch (error) {
    const files = await readdir(consumerDirectory)
    throw new Error(
      `Packed CLI output was not written at ${svgOutputPath}; consumer files: ${files.join(", ")}`,
      { cause: error },
    )
  }
  if (!/<svg\b/u.test(svg)) throw new Error("Packed CLI did not produce SVG output.")
  await run(
    executable,
    [...executableArguments, "render", inputPath, "--output", pngOutputPath, "--width", "1626"],
    consumerDirectory,
    "packed-consumer: render PNG",
  )
  const png = await readFile(pngOutputPath)
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("Packed CLI did not produce PNG output.")
  }
  if (png.readUInt32BE(16) !== 1626 || png.readUInt32BE(20) !== 2370) {
    throw new Error("Packed CLI PNG output did not preserve aspect ratio at the requested width.")
  }
  await run(
    executable,
    [
      ...executableArguments,
      "render",
      inputPath,
      "--output",
      jpegOutputPath,
      "--quality",
      "80",
      "--background",
      "#fff",
    ],
    consumerDirectory,
    "packed-consumer: render JPEG",
  )
  const jpeg = await readFile(jpegOutputPath)
  if (!jpeg.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) {
    throw new Error("Packed CLI did not produce JPEG output.")
  }
  await run(
    executable,
    [...executableArguments, "render", inputPath, "--output", webpOutputPath, "--scale", "0.5"],
    consumerDirectory,
    "packed-consumer: render WebP",
  )
  const webp = await readFile(webpOutputPath)
  if (
    webp.subarray(0, 4).toString("ascii") !== "RIFF" ||
    webp.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    throw new Error("Packed CLI did not produce WebP output.")
  }
  console.log(
    "Verified the packed CLI bin, browser harness, doctor command, and SVG/PNG/JPEG/WebP renders",
  )
} catch (error) {
  failure = error
} finally {
  process.off("SIGINT", interrupt)
  process.off("SIGTERM", terminate)
  await rm(consumerDirectory, { force: true, recursive: true })
}

if (interruptedSignal) {
  console.error(
    `Packed CLI verification interrupted by ${interruptedSignal}; temporary files removed.`,
  )
  process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143
} else if (failure) {
  throw failure
}
