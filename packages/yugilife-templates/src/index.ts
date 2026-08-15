import { generatedDefaultTemplateIds, generatedTemplateEntries } from "./generated-catalog.js"

import type {
  AssetSourceMap,
  CardTemplate,
  CardTemplateBundle,
  ColorPresetCollection,
  TemplateId,
  TemplateIdentity,
  TemplateManifest,
} from "yugilife-core"

export interface TemplateLoadProgress {
  readonly loaded: number
  readonly phase: "downloading" | "ready"
  readonly total?: number | undefined
}

export interface TemplateLoadOptions {
  readonly onProgress?: ((progress: TemplateLoadProgress) => void) | undefined
  readonly signal?: AbortSignal | undefined
}

export type LoadedTemplateBundle = CardTemplateBundle

export interface OfficialTemplate extends CardTemplateBundle, TemplateIdentity {
  load(options?: TemplateLoadOptions): Promise<LoadedTemplateBundle>
}

interface GeneratedTemplateEntry {
  readonly assets: Readonly<Record<string, string>>
  readonly colorPresets: unknown
  readonly manifest: unknown
  readonly template: unknown
}

function contentLength(response: Response) {
  const value = Number(response.headers.get("content-length"))
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

async function readResponse(
  response: Response,
  report: (bytes: number) => void,
  signal?: AbortSignal,
) {
  if (!response.ok) throw new Error(`Template asset download failed with HTTP ${response.status}.`)
  if (!response.body) {
    const blob = await response.blob()
    report(blob.size)
    return blob
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      length += value.byteLength
      report(value.byteLength)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new Blob([bytes], {
    type: response.headers.get("content-type") ?? "application/octet-stream",
  })
}

async function loadBrowserEntry(
  entry: GeneratedTemplateEntry,
  options: TemplateLoadOptions = {},
): Promise<LoadedTemplateBundle> {
  const manifest = entry.manifest as TemplateManifest
  const template = entry.template as CardTemplate
  const assetEntries = Object.entries(entry.assets)
  const responses = await Promise.all(
    assetEntries.map(async ([id, url]) => {
      const response = await fetch(url, options.signal ? { signal: options.signal } : undefined)
      if (!response.ok) {
        throw new Error(
          `Could not download asset "${id}" for template "${manifest.id}": HTTP ${response.status}.`,
        )
      }
      return [id, response] as const
    }),
  )
  const lengths = responses.map(([, response]) => contentLength(response))
  const total = lengths.every((length) => length !== undefined)
    ? lengths.reduce<number>((sum, length) => sum + (length ?? 0), 0)
    : undefined
  let loaded = 0
  const report = (bytes: number) => {
    loaded += bytes
    options.onProgress?.({
      loaded,
      phase: "downloading",
      ...(total === undefined ? {} : { total }),
    })
  }
  options.onProgress?.({
    loaded: 0,
    phase: "downloading",
    ...(total === undefined ? {} : { total }),
  })
  const assets = Object.fromEntries(
    await Promise.all(
      responses.map(async ([id, response]) => [
        id,
        await readResponse(response, report, options.signal),
      ]),
    ),
  ) as AssetSourceMap
  options.onProgress?.({ loaded, phase: "ready", ...(total === undefined ? {} : { total }) })
  return Object.freeze({
    assets,
    colorPresets: entry.colorPresets as ColorPresetCollection,
    manifest,
    template,
  })
}

const entriesById = new Map<TemplateId, GeneratedTemplateEntry>(
  (generatedTemplateEntries as readonly GeneratedTemplateEntry[]).map((entry) => {
    const manifest = entry.manifest as TemplateManifest
    return [manifest.id, entry]
  }),
)

function descriptor(entry: GeneratedTemplateEntry): OfficialTemplate {
  const manifest = entry.manifest as TemplateManifest
  return Object.freeze({
    id: manifest.id,
    kind: manifest.kind,
    manifest,
    name: manifest.name,
    version: manifest.version,
    assets: entry.assets,
    colorPresets: entry.colorPresets as ColorPresetCollection,
    template: entry.template as CardTemplate,
    load: (options?: TemplateLoadOptions) => loadBrowserEntry(entry, options),
  })
}

export const TEMPLATE_CATALOG: readonly OfficialTemplate[] = Object.freeze(
  [...entriesById.values()].map(descriptor),
)

export const DEFAULT_TEMPLATE_ID: TemplateId = generatedDefaultTemplateIds.card

export const DEFAULT_TEMPLATE = TEMPLATE_CATALOG.find(({ id }) => id === DEFAULT_TEMPLATE_ID)!

export function getOfficialTemplate(id: TemplateId) {
  const template = TEMPLATE_CATALOG.find((candidate) => candidate.id === id)
  if (!template) throw new Error(`The official template catalog does not contain "${id}".`)
  return template
}
