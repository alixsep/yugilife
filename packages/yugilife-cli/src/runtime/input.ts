import { readFile } from "node:fs/promises"
import path from "node:path"

import { CliError } from "./errors.js"
import { resolveCliTemplate } from "./template-store.js"

import type {
  RasterRenderFormat,
  RenderFormat,
  SerializedRenderRequest,
  SvgTextMode,
} from "./protocol.js"

interface RawRenderInput {
  readonly card: Readonly<Record<string, unknown>>
  readonly files?: Readonly<Record<string, unknown>>
  readonly template?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function invalidInput(message: string, options?: ErrorOptions) {
  return new CliError("INPUT_INVALID", message, options)
}

function mimeTypeFor(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  switch (extension) {
    case ".avif":
      return "image/avif"
    case ".bmp":
      return "image/bmp"
    case ".gif":
      return "image/gif"
    case ".jpe":
    case ".jpeg":
    case ".jpg":
      return "image/jpeg"
    case ".svg":
      return "image/svg+xml"
    case ".otf":
      return "font/otf"
    case ".ttf":
      return "font/ttf"
    case ".woff":
      return "font/woff"
    case ".woff2":
      return "font/woff2"
    case ".webp":
      return "image/webp"
    case ".png":
      return "image/png"
    default:
      return "application/octet-stream"
  }
}

function resolveFilePath(inputDirectory: string, reference: string, key: string) {
  if (reference.length === 0 || reference.includes("\0")) {
    throw invalidInput(`File reference "${key}" must be a non-empty path.`)
  }
  if (/^[a-z][a-z\d+.-]*:/iu.test(reference) && !/^[a-z]:[\\/]/iu.test(reference)) {
    throw invalidInput(`File reference "${key}" must be a local filesystem path.`)
  }
  return path.isAbsolute(reference) || path.win32.isAbsolute(reference)
    ? path.normalize(reference)
    : path.resolve(inputDirectory, reference)
}

async function readFileAsDataUrl(
  inputDirectory: string,
  reference: string,
  key: string,
): Promise<string> {
  const filePath = resolveFilePath(inputDirectory, reference, key)
  let contents: Buffer
  try {
    contents = await readFile(filePath)
  } catch (error) {
    throw new CliError("INPUT_READ_FAILED", `Could not read file "${reference}" for "${key}".`, {
      cause: error,
    })
  }
  if (contents.byteLength === 0) {
    throw invalidInput(`File "${reference}" for "${key}" is empty.`)
  }
  return `data:${mimeTypeFor(filePath)};base64,${contents.toString("base64")}`
}

function parseInput(value: unknown, inputPath: string): RawRenderInput {
  if (!isRecord(value)) {
    throw invalidInput(`Input "${inputPath}" must contain a JSON object.`)
  }
  if (!isRecord(value.card)) {
    throw invalidInput(`Input "${inputPath}" must contain a "card" object.`)
  }
  if (value.template !== undefined && typeof value.template !== "string") {
    throw invalidInput(`Input "${inputPath}" field "template" must be a string.`)
  }
  if (value.files !== undefined && !isRecord(value.files)) {
    throw invalidInput(`Input "${inputPath}" field "files" must be an object.`)
  }
  return {
    card: value.card,
    ...(value.files === undefined ? {} : { files: value.files }),
    ...(value.template === undefined ? {} : { template: value.template }),
  }
}

function outputFormat(outputPath: string): RenderFormat {
  switch (path.extname(outputPath).toLowerCase()) {
    case ".jpeg":
    case ".jpg":
      return "jpeg"
    case ".png":
      return "png"
    case ".svg":
      return "svg"
    case ".webp":
      return "webp"
    default:
      throw new CliError(
        "OUTPUT_INVALID",
        `Output "${outputPath}" must use a .png, .jpg, .jpeg, .webp, or .svg extension.`,
      )
  }
}

function rasterOptions(
  format: RenderFormat,
  options: {
    readonly backgroundColor?: string
    readonly height?: number
    readonly quality?: number
    readonly scale?: number
    readonly width?: number
  },
): SerializedRenderRequest["rasterOptions"] {
  const sizeEntries = [
    ["height", options.height],
    ["scale", options.scale],
    ["width", options.width],
  ] as const
  const suppliedSizes = sizeEntries.filter((entry) => entry[1] !== undefined)
  const hasRasterOptions =
    suppliedSizes.length > 0 ||
    options.quality !== undefined ||
    options.backgroundColor !== undefined
  if (format === "svg") {
    if (hasRasterOptions) {
      throw invalidInput(
        "Raster size, quality, and background options cannot be used with SVG output.",
      )
    }
    return undefined
  }
  if (suppliedSizes.length > 1) {
    throw invalidInput("Use only one of --height, --scale, or --width.")
  }
  const [sizeEntry] = suppliedSizes
  if (sizeEntry) {
    const [name, value] = sizeEntry
    if (value === undefined || !Number.isFinite(value) || value <= 0) {
      throw invalidInput(`--${name} must be finite and greater than zero.`)
    }
    if (name !== "scale" && !Number.isSafeInteger(value)) {
      throw invalidInput(`--${name} must be a positive whole number of pixels.`)
    }
  }
  if (options.quality !== undefined) {
    if (format === "png") throw invalidInput("--quality cannot be used with PNG output.")
    if (!Number.isFinite(options.quality) || options.quality < 0 || options.quality > 1) {
      throw invalidInput("--quality must be from 0 through 100.")
    }
  }
  if (options.backgroundColor !== undefined) {
    if (format !== "jpeg") throw invalidInput("--background can be used only with JPEG output.")
    if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/iu.test(options.backgroundColor)) {
      throw invalidInput("--background must be an opaque #RGB or #RRGGBB color.")
    }
  }
  let size: NonNullable<SerializedRenderRequest["rasterOptions"]>["size"]
  if (sizeEntry?.[1] !== undefined) {
    switch (sizeEntry[0]) {
      case "height":
        size = { height: sizeEntry[1] }
        break
      case "scale":
        size = { scale: sizeEntry[1] }
        break
      case "width":
        size = { width: sizeEntry[1] }
        break
    }
  }
  return {
    ...(options.backgroundColor === undefined ? {} : { backgroundColor: options.backgroundColor }),
    ...(options.quality === undefined ? {} : { quality: options.quality }),
    ...(size === undefined ? {} : { size }),
  }
}

export function normalizeTextMode(value: string | undefined): SvgTextMode | undefined {
  if (value === undefined) return undefined
  if (value !== "paths" && value !== "text") {
    throw new CliError(
      "ARGUMENT_ERROR",
      `Unknown SVG text mode "${value}". Expected "paths" or "text".`,
    )
  }
  return value
}

export async function loadRenderRequest(
  inputPath: string,
  outputPath: string,
  options: {
    readonly backgroundColor?: string
    readonly height?: number
    readonly quality?: number
    readonly scale?: number
    readonly templateReference?: string
    readonly textMode?: SvgTextMode
    readonly title?: string
    readonly useDefaultTemplate?: boolean
    readonly width?: number
  } = {},
): Promise<SerializedRenderRequest> {
  const resolvedInputPath = path.resolve(inputPath)
  let inputContents: string
  try {
    inputContents = await readFile(resolvedInputPath, "utf8")
  } catch (error) {
    throw new CliError("INPUT_READ_FAILED", `Could not read input "${inputPath}".`, {
      cause: error,
    })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(inputContents)
  } catch (error) {
    throw new CliError("INPUT_JSON_INVALID", `Input "${inputPath}" is not valid JSON.`, {
      cause: error,
    })
  }
  const input = parseInput(parsed, inputPath)
  const files = Object.create(null) as Record<string, string>
  for (const [key, reference] of Object.entries(input.files ?? {})) {
    if (typeof reference !== "string") {
      throw invalidInput(`File reference "${key}" in "${inputPath}" must be a string.`)
    }
    files[key] = await readFileAsDataUrl(path.dirname(resolvedInputPath), reference, key)
  }

  const inputTemplateId = input.template
  if (options.useDefaultTemplate && (inputTemplateId !== undefined || options.templateReference)) {
    throw invalidInput("--use-default-template cannot be combined with another template selector.")
  }
  if (options.templateReference && inputTemplateId !== undefined) {
    throw invalidInput("--template cannot be combined with a template selector in the input JSON.")
  }
  const templateId = options.useDefaultTemplate
    ? undefined
    : (options.templateReference ?? inputTemplateId)
  const templateBundle = await resolveCliTemplate(templateId)
  const format = outputFormat(outputPath)
  if (format !== "svg" && (options.textMode !== undefined || options.title !== undefined)) {
    throw invalidInput("--text-mode and --title can be used only with SVG output.")
  }
  const resolvedRasterOptions = rasterOptions(format, options)
  return {
    card: input.card,
    files,
    format,
    ...(resolvedRasterOptions === undefined ? {} : { rasterOptions: resolvedRasterOptions }),
    templateBundle,
    ...(options.textMode === undefined ? {} : { textMode: options.textMode }),
    ...(options.title === undefined ? {} : { title: options.title }),
  }
}

const rasterMimeTypes: Readonly<Record<RasterRenderFormat, string>> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
}

export function decodeRasterDataUrl(
  dataUrl: string,
  format: RasterRenderFormat,
  outputPath: string,
): Buffer {
  const mimeType = rasterMimeTypes[format]
  const match = new RegExp(`^data:${mimeType};base64,(?<payload>[a-z\\d+/]+=*)$`, "iu").exec(
    dataUrl,
  )
  if (!match?.groups?.payload) {
    throw new CliError(
      "OUTPUT_WRITE_FAILED",
      `The browser returned malformed ${format.toUpperCase()} output for "${outputPath}".`,
    )
  }
  return Buffer.from(match.groups.payload, "base64")
}
