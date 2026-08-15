#!/usr/bin/env node

import { realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

import { runDoctor } from "./commands/doctor.js"
import { runRender } from "./commands/render.js"
import { asCliError, CliError } from "./runtime/errors.js"
import { normalizeTextMode } from "./runtime/input.js"
import { installCliTemplate, listCliTemplates } from "./runtime/template-store.js"
import { cliVersion } from "./version.js"

interface CliIo {
  readonly stderr: Pick<NodeJS.WriteStream, "write">
  readonly stdout: Pick<NodeJS.WriteStream, "write">
}

const helpText = `YugiLife CLI ${cliVersion}

Usage:
  yugilife-cli doctor
  yugilife-cli render <card.json> --output <card.svg|card.png|card.jpg|card.webp>
  yugilife-cli templates list
  yugilife-cli templates install <template-id@version>

Options:
  -o, --output <path>       Output SVG, PNG, JPEG, or WebP path
      --scale <number>      Raster output scale; defaults to 1
      --width <pixels>      Raster output width; preserves aspect ratio
      --height <pixels>     Raster output height; preserves aspect ratio
      --quality <0-100>     JPEG/WebP quality; defaults to 92
      --background <color>  JPEG matte as #RGB or #RRGGBB; defaults to white
      --text-mode <mode>    SVG text mode: paths (default) or text
      --title <title>       Optional SVG title
      --template <id>       Use an installed template ID or exact ID@version
      --use-default-template
                            Explicitly use the packaged default template
      --registry <url>      Template registry catalog used only by templates install
  -h, --help                Show this help
  -v, --version             Show the CLI version
`

function parseCliArguments(argv: readonly string[]) {
  try {
    return parseArgs({
      allowPositionals: true,
      args: [...argv],
      options: {
        background: { type: "string" },
        help: { short: "h", type: "boolean" },
        height: { type: "string" },
        output: { short: "o", type: "string" },
        quality: { type: "string" },
        registry: { type: "string" },
        scale: { type: "string" },
        template: { type: "string" },
        "text-mode": { type: "string" },
        title: { type: "string" },
        "use-default-template": { type: "boolean" },
        version: { short: "v", type: "boolean" },
        width: { type: "string" },
      },
      strict: true,
    })
  } catch (error) {
    throw new CliError("ARGUMENT_ERROR", error instanceof Error ? error.message : String(error), {
      cause: error,
    })
  }
}

function asString(value: string | boolean | undefined) {
  return typeof value === "string" ? value : undefined
}

function asBoolean(value: string | boolean | undefined) {
  return value === true
}

function numberOption(value: string | undefined, name: string) {
  if (value === undefined) return undefined
  if (value.trim().length === 0) usageError(`${name} requires a number.`)
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) usageError(`${name} requires a finite number.`)
  return parsed
}

function qualityOption(value: string | undefined) {
  const quality = numberOption(value, "--quality")
  if (quality === undefined) return undefined
  if (quality < 0 || quality > 100) usageError("--quality must be from 0 through 100.")
  return quality / 100
}

function usageError(message: string): never {
  throw new CliError("ARGUMENT_ERROR", `${message}\n\n${helpText}`)
}

async function dispatch(argv: readonly string[], signal: AbortSignal, io: CliIo) {
  const { positionals, values } = parseCliArguments(argv)
  if (asBoolean(values.version)) {
    if (positionals.length > 0) usageError("--version cannot be combined with a command.")
    io.stdout.write(`${cliVersion}\n`)
    return
  }
  if (asBoolean(values.help)) {
    if (positionals.length > 0) usageError("--help cannot be combined with a command.")
    io.stdout.write(helpText)
    return
  }

  const [command, ...commandArguments] = positionals
  if (command === "doctor") {
    if (commandArguments.length > 0) usageError("doctor does not accept positional arguments.")
    io.stdout.write(await runDoctor(signal))
    return
  }
  if (command === "templates") {
    const [templateCommand, ...templateArguments] = commandArguments
    if (templateCommand === "list") {
      if (templateArguments.length > 0) usageError("templates list does not accept arguments.")
      const installed = await listCliTemplates()
      installed.forEach((template) =>
        io.stdout.write(
          `${template.id}@${template.version}\t${template.source}\t${template.name}\n`,
        ),
      )
      return
    }
    if (templateCommand === "install") {
      if (templateArguments.length !== 1) {
        usageError("templates install requires exactly one template ID and version.")
      }
      const reference = templateArguments[0]!
      const registry = asString(values.registry)
      const result = await installCliTemplate(reference, {
        ...(registry === undefined ? {} : { registry }),
        signal,
      })
      io.stdout.write(
        result.alreadyInstalled
          ? `${reference} is already available locally.\n`
          : `Installed ${reference}.\n`,
      )
      return
    }
    usageError("Expected a templates command: list or install.")
  }
  if (command !== "render") usageError("Expected a command: doctor, render, or templates.")
  if (commandArguments.length !== 1) usageError("render requires exactly one input JSON path.")
  const inputPath = commandArguments[0]
  if (!inputPath) usageError("render requires an input JSON path.")
  const output = asString(values.output)
  if (!output) usageError("render requires --output <path>.")
  const textMode = normalizeTextMode(asString(values["text-mode"]))
  const title = asString(values.title)
  const templateReference = asString(values.template)
  const backgroundColor = asString(values.background)
  const height = numberOption(asString(values.height), "--height")
  const quality = qualityOption(asString(values.quality))
  const scale = numberOption(asString(values.scale), "--scale")
  const width = numberOption(asString(values.width), "--width")
  const warnings = await runRender(inputPath, output, {
    ...(backgroundColor === undefined ? {} : { backgroundColor }),
    ...(height === undefined ? {} : { height }),
    ...(quality === undefined ? {} : { quality }),
    ...(scale === undefined ? {} : { scale }),
    signal,
    ...(templateReference === undefined ? {} : { templateReference }),
    ...(textMode === undefined ? {} : { textMode }),
    ...(title === undefined ? {} : { title }),
    useDefaultTemplate: asBoolean(values["use-default-template"]),
    ...(width === undefined ? {} : { width }),
  })
  for (const warning of warnings) {
    io.stderr.write(
      `yugilife-cli warning [${warning.code}] ${warning.layerId}: ${warning.message}\n`,
    )
  }
}

export async function runCli(
  argv: readonly string[] = process.argv.slice(2),
  io: CliIo = { stderr: process.stderr, stdout: process.stdout },
) {
  const interruption = new AbortController()
  let interruptedSignal: "SIGINT" | "SIGTERM" | undefined
  const interrupt = (signal: "SIGINT" | "SIGTERM") => {
    if (interruptedSignal) return
    interruptedSignal = signal
    interruption.abort(new Error(`Interrupted by ${signal}.`))
  }
  const onSigint = () => interrupt("SIGINT")
  const onSigterm = () => interrupt("SIGTERM")
  process.once("SIGINT", onSigint)
  process.once("SIGTERM", onSigterm)
  try {
    await dispatch(argv, interruption.signal, io)
    return 0
  } catch (error) {
    const cliError = asCliError(error)
    if (interruptedSignal && cliError.code === "INTERNAL_ERROR") {
      cliError.message = `Interrupted by ${interruptedSignal}.`
    }
    io.stderr.write(`yugilife-cli [${cliError.code}]: ${cliError.message}\n`)
    return interruptedSignal && cliError.code === "CLI_INTERRUPTED"
      ? interruptedSignal === "SIGINT"
        ? 130
        : 143
      : cliError.exitCode
  } finally {
    process.off("SIGINT", onSigint)
    process.off("SIGTERM", onSigterm)
  }
}

function isMainModule() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isMainModule()) {
  process.exitCode = await runCli()
}
