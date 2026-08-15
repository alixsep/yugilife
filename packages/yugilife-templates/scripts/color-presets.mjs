import { createHash } from "node:crypto"
import { mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { runCommand } from "../../../scripts/run-command.mjs"

const chromapairVersion = "1.0.0"
const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const templatesDirectory = path.join(packageDirectory, "templates")
const checkOnly = process.argv.includes("--check")
const provenanceFileName = "color-presets.provenance.json"
const outputFileName = "color-presets.json"
let interruptedSignal
const interruption = new AbortController()

async function findFiles(directory, basename) {
  const entries = await readdir(directory, { withFileTypes: true })
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const resolved = path.join(directory, entry.name)
        if (entry.isDirectory()) return findFiles(resolved, basename)
        return entry.name === basename ? [resolved] : []
      }),
    )
  ).flat()
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function packageRelative(file) {
  return path.relative(packageDirectory, file).replaceAll(path.sep, "/")
}

function referencedInputPaths(config, configFile) {
  const templateDirectory = path.dirname(configFile)
  const relativePaths = [
    config.defaults?.source,
    ...config.jobs.flatMap((job) => [job.source, job.reference]),
  ]
    .filter((value) => typeof value === "string")
    .map((value) => path.resolve(templateDirectory, value))
  return [configFile, ...new Set(relativePaths)].sort()
}

async function createProvenance(configFile, output) {
  const config = JSON.parse(await readFile(configFile, "utf8"))
  const inputs = []
  for (const inputFile of referencedInputPaths(config, configFile)) {
    inputs.push({
      path: packageRelative(inputFile),
      sha256: sha256(await readFile(inputFile)),
    })
  }
  return {
    schemaVersion: 1,
    generator: `chromapair@${chromapairVersion}`,
    inputs,
    output: {
      path: packageRelative(path.join(path.dirname(configFile), outputFileName)),
      sha256: sha256(output),
    },
  }
}

async function verifyGeneratedPresets(configFile) {
  const templateDirectory = path.dirname(configFile)
  const outputFile = path.join(templateDirectory, outputFileName)
  const provenanceFile = path.join(templateDirectory, provenanceFileName)
  let output
  let current
  try {
    ;[output, current] = await Promise.all([
      readFile(outputFile),
      readFile(provenanceFile, "utf8").then(JSON.parse),
    ])
  } catch (error) {
    throw new Error(
      `Generated color presets for ${packageRelative(configFile)} are incomplete; run pnpm generate:assets from the repository root.`,
      { cause: error },
    )
  }
  const expected = await createProvenance(configFile, output)
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new Error(
      `Generated color presets for ${packageRelative(configFile)} are stale; run pnpm generate:assets from the repository root.`,
    )
  }
  console.log(`Verified generated color presets for ${packageRelative(configFile)}`)
}

function makeStagedConfig(config, configFile, outputDirectory) {
  const templateDirectory = path.dirname(configFile)
  const resolveInput = (value) =>
    typeof value === "string" ? path.resolve(templateDirectory, value) : value
  return {
    ...config,
    defaults: {
      ...config.defaults,
      source: resolveInput(config.defaults?.source),
    },
    output: {
      ...config.output,
      combinedPresets: outputFileName,
      directory: outputDirectory,
      report: "report.json",
    },
    jobs: config.jobs.map((job) => ({
      ...job,
      ...(job.source === undefined ? {} : { source: resolveInput(job.source) }),
      ...(job.reference === undefined ? {} : { reference: resolveInput(job.reference) }),
    })),
  }
}

async function runChromapair(configFile) {
  try {
    await runCommand(
      "uvx",
      [
        "--from",
        `chromapair==${chromapairVersion}`,
        "chromapair",
        "batch",
        "--config",
        configFile,
        "--no-previews",
      ],
      {
        cwd: packageDirectory,
        label: `color-presets: ${packageRelative(configFile)}`,
        signal: interruption.signal,
        timeoutMs: 1_800_000,
      },
    )
  } catch (error) {
    if (error.code !== "ENOENT") throw error
    throw new Error(
      "uvx is required for color-preset generation; install uv from https://docs.astral.sh/uv/.",
      { cause: error },
    )
  }
}

async function generatePresets(configFiles) {
  const stagingRoot = await mkdtemp(path.join(os.tmpdir(), "yugilife-color-presets-"))
  const generated = []
  try {
    for (const [index, configFile] of configFiles.entries()) {
      const config = JSON.parse(await readFile(configFile, "utf8"))
      const outputDirectory = path.join(stagingRoot, String(index))
      const stagedConfigFile = path.join(stagingRoot, `config-${index}.json`)
      await writeFile(
        stagedConfigFile,
        `${JSON.stringify(makeStagedConfig(config, configFile, outputDirectory), null, 2)}\n`,
      )
      console.log(`Generating color presets for ${packageRelative(configFile)}`)
      await runChromapair(stagedConfigFile)
      const output = await readFile(path.join(outputDirectory, outputFileName))
      if (output.length === 0) {
        throw new Error(`Chromapair produced an empty ${outputFileName} for ${configFile}.`)
      }
      generated.push({
        configFile,
        output,
        provenance: await createProvenance(configFile, output),
        report: await readFile(path.join(outputDirectory, "report.json")),
      })
    }

    for (const entry of generated) {
      const templateDirectory = path.dirname(entry.configFile)
      const writes = [
        [path.join(templateDirectory, outputFileName), entry.output],
        [
          path.join(templateDirectory, provenanceFileName),
          `${JSON.stringify(entry.provenance, null, 2)}\n`,
        ],
        [path.join(templateDirectory, "report.json"), entry.report],
      ]
      await Promise.all(
        writes.map(async ([destination, contents]) => {
          const temporary = `${destination}.tmp`
          await writeFile(temporary, contents)
          await rename(temporary, destination)
        }),
      )
      await Promise.all([
        rm(path.join(templateDirectory, "presets"), { force: true, recursive: true }),
        rm(path.join(templateDirectory, "textures"), { force: true, recursive: true }),
      ])
      console.log(`Generated ${packageRelative(path.join(templateDirectory, outputFileName))}`)
    }
  } finally {
    await rm(stagingRoot, { force: true, recursive: true })
  }
}

const configFiles = (await findFiles(templatesDirectory, "chromapair-config.json")).sort()
if (configFiles.length === 0)
  throw new Error("No template-local chromapair-config.json files found.")

if (checkOnly) {
  await Promise.all(configFiles.map(verifyGeneratedPresets))
} else {
  const handleSignal = (signal) => {
    if (interruptedSignal) return
    interruptedSignal = signal
    interruption.abort(new Error(`Color-preset generation interrupted by ${signal}.`))
  }
  const interrupt = () => handleSignal("SIGINT")
  const terminate = () => handleSignal("SIGTERM")
  process.on("SIGINT", interrupt)
  process.on("SIGTERM", terminate)
  let failure
  try {
    await generatePresets(configFiles)
  } catch (error) {
    failure = error
  } finally {
    process.off("SIGINT", interrupt)
    process.off("SIGTERM", terminate)
  }
  if (interruptedSignal) {
    console.error(`Color-preset generation interrupted by ${interruptedSignal}; staging removed.`)
    process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143
  } else if (failure) {
    throw failure
  }
}
