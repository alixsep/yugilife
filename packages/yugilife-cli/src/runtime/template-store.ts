import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { validateCardTemplate, validateTemplateManifest } from "yugilife-core"
import {
  DEFAULT_TEMPLATE_ID,
  loadInstalledTemplate,
  PACKAGED_TEMPLATES,
} from "yugilife-templates/node"

import { CliError } from "./errors.js"

import type {
  CardTemplate,
  ColorPresetCollection,
  TemplateIdentity,
  TemplateManifest,
} from "yugilife-core"

interface LocalTemplateBundle {
  readonly assets: Readonly<Record<string, string>>
  readonly colorPresets: ColorPresetCollection
  readonly manifest: TemplateManifest
  readonly template: CardTemplate
}

interface StoredTemplateArtifact {
  readonly assets: Readonly<Record<string, string>>
  readonly colorPresets: unknown
  readonly format: "yugilife-template"
  readonly formatVersion: 1
  readonly manifest: unknown
  readonly template: unknown
}

interface RegistryEntry {
  readonly id: string
  readonly sha256: string
  readonly size: number
  readonly url: string
  readonly version: string
}

const maximumArtifactBytes = 128 * 1024 * 1024

function storeRoot() {
  const configured = process.env["YUGILIFE_TEMPLATE_HOME"]
  if (configured) return path.resolve(configured)
  const dataHome = process.env["XDG_DATA_HOME"]
  return path.join(
    dataHome ? path.resolve(dataHome) : path.join(os.homedir(), ".local", "share"),
    "yugilife",
    "templates",
  )
}

function parseExactReference(reference: string) {
  const match = /^(?<id>[^@\s]+)@(?<version>[^@\s]+)$/u.exec(reference)
  if (!match?.groups?.id || !isTemplateVersion(match.groups.version)) {
    throw new CliError(
      "ARGUMENT_ERROR",
      `Template reference "${reference}" must use an exact ID and version, for example card/series-10@2026.08.15.`,
    )
  }
  if (!/^[a-z\d][a-z\d-]*(?:\/[a-z\d][a-z\d-]*)+$/u.test(match.groups.id)) {
    throw new CliError("ARGUMENT_ERROR", `Template ID "${match.groups.id}" is malformed.`)
  }
  return { id: match.groups.id, version: match.groups.version }
}

function artifactPath(id: string, version: string) {
  const safeId = id.split("/").map(encodeURIComponent).join(path.sep)
  return path.join(storeRoot(), safeId, `${version}.json`)
}

function validateArtifact(value: unknown): LocalTemplateBundle {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Template artifact must contain an object.")
  }
  const artifact = value as Partial<StoredTemplateArtifact>
  if (artifact.format !== "yugilife-template" || artifact.formatVersion !== 1) {
    throw new Error("Template artifact has an unsupported format.")
  }
  if (!artifact.assets || typeof artifact.assets !== "object" || Array.isArray(artifact.assets)) {
    throw new Error("Template artifact assets must be an object.")
  }
  for (const [id, source] of Object.entries(artifact.assets)) {
    if (!id || typeof source !== "string" || !source.startsWith("data:")) {
      throw new Error(`Template artifact asset "${id}" must be a data URL.`)
    }
  }
  const manifest = validateTemplateManifest(artifact.manifest)
  const template = validateCardTemplate(artifact.template)
  for (const assetId of Object.keys(manifest.assets)) {
    if (!(assetId in artifact.assets)) {
      throw new Error(`Template artifact is missing declared asset "${assetId}".`)
    }
  }
  return {
    assets: artifact.assets,
    colorPresets: (artifact.colorPresets ?? {}) as ColorPresetCollection,
    manifest,
    template,
  }
}

async function readStoredTemplate(id: string, version: string) {
  try {
    const contents = await readFile(artifactPath(id, version), "utf8")
    const bundle = validateArtifact(JSON.parse(contents))
    if (bundle.manifest.id !== id || bundle.manifest.version !== version) {
      throw new Error("Stored template identity does not match its installation path.")
    }
    return bundle
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw new CliError("TEMPLATE_INVALID", `Installed template "${id}@${version}" is invalid.`, {
      cause: error,
    })
  }
}

async function newestStoredVersion(id: string) {
  const directory = path.dirname(artifactPath(id, "2000.01.01"))
  try {
    const versions = (await readdir(directory))
      .map(
        (name) =>
          /^(?<version>\d{4}\.\d{2}\.\d{2}(?:\.[1-9]\d*)?)\.json$/u.exec(name)?.groups?.version,
      )
      .filter((value): value is string => value !== undefined && isTemplateVersion(value))
    return versions.sort((left, right) => compareTemplateVersions(right, left))[0]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

export async function resolveCliTemplate(reference?: string): Promise<LocalTemplateBundle> {
  const requestedExact = reference?.includes("@") ? parseExactReference(reference) : undefined
  const requestedId = requestedExact?.id ?? reference ?? DEFAULT_TEMPLATE_ID
  const packaged = PACKAGED_TEMPLATES.find(({ id }) => id === requestedId)
  if (packaged && (!requestedExact || requestedExact.version === packaged.version)) {
    return await loadInstalledTemplate(packaged.id)
  }
  const exact =
    requestedExact ??
    (reference ? { id: reference, version: await newestStoredVersion(reference) } : undefined)
  if (exact?.version !== undefined) {
    const stored = await readStoredTemplate(exact.id, exact.version)
    if (stored) return stored
  }
  const requested = reference ?? DEFAULT_TEMPLATE_ID
  throw new CliError(
    "TEMPLATE_NOT_INSTALLED",
    `Template "${requested}" is not installed. Run yugilife-cli templates install ${requested.includes("@") ? requested : `${requested}@<version>`}.`,
  )
}

function registryEntry(value: unknown, id: string, version: string): RegistryEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const catalog = value as { templates?: unknown }
  if (!Array.isArray(catalog.templates)) return undefined
  return catalog.templates.find((candidate): candidate is RegistryEntry => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false
    const entry = candidate as Partial<RegistryEntry>
    return (
      entry.id === id &&
      entry.version === version &&
      typeof entry.url === "string" &&
      typeof entry.sha256 === "string" &&
      /^[a-f\d]{64}$/u.test(entry.sha256) &&
      typeof entry.size === "number" &&
      Number.isSafeInteger(entry.size) &&
      entry.size > 0 &&
      entry.size <= maximumArtifactBytes
    )
  })
}

async function downloadBytes(url: URL, expectedSize: number, signal?: AbortSignal) {
  const response = await fetch(url, signal ? { signal } : undefined)
  if (!response.ok) throw new Error(`HTTP ${response.status} while downloading ${url.href}.`)
  if (!response.body) throw new Error("Template registry returned an empty response body.")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > expectedSize || length > maximumArtifactBytes) {
        throw new Error("Downloaded template exceeds its declared or permitted size.")
      }
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  if (length !== expectedSize) {
    throw new Error(`Downloaded ${length} bytes; registry declared ${expectedSize}.`)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export async function installCliTemplate(
  reference: string,
  options: { readonly registry?: string; readonly signal?: AbortSignal } = {},
) {
  const { id, version } = parseExactReference(reference)
  const packaged = PACKAGED_TEMPLATES.find(
    (candidate) => candidate.id === id && candidate.version === version,
  )
  if (packaged) return { alreadyInstalled: true, identity: packaged }
  const installed = await readStoredTemplate(id, version)
  if (installed) {
    return {
      alreadyInstalled: true,
      identity: {
        id: installed.manifest.id,
        kind: installed.manifest.kind,
        name: installed.manifest.name,
        version: installed.manifest.version,
      },
    }
  }

  const registry = options.registry ?? process.env["YUGILIFE_TEMPLATE_REGISTRY_URL"]
  if (!registry) {
    throw new CliError(
      "TEMPLATE_REGISTRY_UNAVAILABLE",
      "No template registry is configured. Pass --registry <catalog-url> or set YUGILIFE_TEMPLATE_REGISTRY_URL.",
    )
  }
  let catalogUrl: URL
  let catalog: unknown
  try {
    catalogUrl = new URL(registry)
    const response = await fetch(
      catalogUrl,
      options.signal ? { signal: options.signal } : undefined,
    )
    if (!response.ok) throw new Error(`Template registry returned HTTP ${response.status}.`)
    catalog = await response.json()
  } catch (error) {
    throw new CliError(
      "TEMPLATE_REGISTRY_UNAVAILABLE",
      `Could not read template registry "${registry}".`,
      {
        cause: error,
      },
    )
  }
  const entry = registryEntry(catalog, id, version)
  if (!entry) {
    throw new CliError("TEMPLATE_NOT_FOUND", `Registry does not contain "${reference}".`)
  }
  const bytes = await downloadBytes(new URL(entry.url, catalogUrl), entry.size, options.signal)
  const digest = createHash("sha256").update(bytes).digest("hex")
  if (digest !== entry.sha256) {
    throw new CliError("TEMPLATE_INVALID", `Integrity verification failed for "${reference}".`)
  }
  let bundle: LocalTemplateBundle
  try {
    bundle = validateArtifact(JSON.parse(new TextDecoder().decode(bytes)))
  } catch (error) {
    throw new CliError("TEMPLATE_INVALID", `Downloaded artifact for "${reference}" is invalid.`, {
      cause: error,
    })
  }
  if (bundle.manifest.id !== id || bundle.manifest.version !== version) {
    throw new CliError(
      "TEMPLATE_INVALID",
      `Downloaded artifact identity does not match "${reference}".`,
    )
  }
  const destination = artifactPath(id, version)
  await mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.tmp`
  try {
    await writeFile(temporary, bytes, { flag: "wx" })
    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true })
  }
  return {
    alreadyInstalled: false,
    identity: {
      id: bundle.manifest.id,
      kind: bundle.manifest.kind,
      name: bundle.manifest.name,
      version: bundle.manifest.version,
    } satisfies TemplateIdentity,
  }
}

export async function listCliTemplates() {
  const packaged = PACKAGED_TEMPLATES.map((identity) => ({
    ...identity,
    source: "packaged" as const,
  }))
  const stored: Array<TemplateIdentity & { source: "installed" }> = []
  async function walk(directory: string) {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return
      throw error
    }
    for (const entry of entries) {
      const resolved = path.join(directory, entry.name)
      if (entry.isDirectory()) await walk(resolved)
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        try {
          const bundle = validateArtifact(JSON.parse(await readFile(resolved, "utf8")))
          stored.push({
            id: bundle.manifest.id,
            kind: bundle.manifest.kind,
            name: bundle.manifest.name,
            source: "installed",
            version: bundle.manifest.version,
          })
        } catch {
          // Invalid entries are reported when selected; listing remains useful for valid templates.
        }
      }
    }
  }
  await walk(storeRoot())
  return [...packaged, ...stored].sort(
    (left, right) =>
      left.id.localeCompare(right.id) || compareTemplateVersions(left.version, right.version),
  )
}
function templateVersionParts(version: string) {
  return version.split(".").map(Number)
}

function isTemplateVersion(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}\.\d{2}\.\d{2}(?:\.[1-9]\d*)?$/u.test(value)) {
    return false
  }
  const [year, month, day] = templateVersionParts(value)
  if (!year || !month || !day) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

export function compareTemplateVersions(left: string, right: string) {
  const leftParts = templateVersionParts(left)
  const rightParts = templateVersionParts(right)
  for (let index = 0; index < 4; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}
