import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { generatedDefaultTemplateIds, generatedTemplateEntries } from "./generated-catalog.js"

import type {
  CardTemplate,
  ColorPresetCollection,
  TemplateId,
  TemplateManifest,
} from "yugilife-core"

export interface InstalledTemplateBundle {
  readonly assets: Readonly<Record<string, string>>
  readonly colorPresets: ColorPresetCollection
  readonly manifest: TemplateManifest
  readonly template: CardTemplate
}

interface GeneratedTemplateEntry {
  readonly assets: Readonly<Record<string, string>>
  readonly colorPresets: unknown
  readonly manifest: unknown
  readonly template: unknown
}

function mimeType(file: URL) {
  const pathname = file.pathname.toLowerCase()
  if (pathname.endsWith(".svg")) return "image/svg+xml"
  if (pathname.endsWith(".webp")) return "image/webp"
  if (pathname.endsWith(".png")) return "image/png"
  if (pathname.endsWith(".woff2")) return "font/woff2"
  if (pathname.endsWith(".woff")) return "font/woff"
  if (pathname.endsWith(".otf")) return "font/otf"
  if (pathname.endsWith(".ttf")) return "font/ttf"
  return "application/octet-stream"
}

function localAssetUrl(value: string) {
  const url = new URL(value, import.meta.url)
  if (url.protocol !== "file:") {
    throw new Error(`Installed template assets must be local files; received "${url.protocol}".`)
  }
  return url
}

async function dataUrl(value: string) {
  const url = localAssetUrl(value)
  const contents = await readFile(fileURLToPath(url))
  return `data:${mimeType(url)};base64,${contents.toString("base64")}`
}

export const DEFAULT_TEMPLATE_ID: TemplateId = generatedDefaultTemplateIds.card

export const PACKAGED_TEMPLATES = Object.freeze(
  (generatedTemplateEntries as unknown as readonly GeneratedTemplateEntry[]).map((entry) => {
    const manifest = entry.manifest as TemplateManifest
    return Object.freeze({
      id: manifest.id,
      kind: manifest.kind,
      name: manifest.name,
      version: manifest.version,
    })
  }),
)

export async function loadInstalledTemplate(
  id: TemplateId = DEFAULT_TEMPLATE_ID,
): Promise<InstalledTemplateBundle> {
  const entry = (generatedTemplateEntries as unknown as readonly GeneratedTemplateEntry[]).find(
    (candidate) => {
      const manifest = candidate.manifest as TemplateManifest
      return manifest.id === id
    },
  )
  if (!entry) throw new Error(`Official template "${id}" is not installed with this package.`)
  const manifest = entry.manifest as TemplateManifest
  const template = entry.template as CardTemplate
  const assets = Object.fromEntries(
    await Promise.all(
      Object.entries(entry.assets).map(async ([assetId, source]) => [
        assetId,
        await dataUrl(source),
      ]),
    ),
  ) as Readonly<Record<string, string>>
  return Object.freeze({
    assets,
    colorPresets: entry.colorPresets as ColorPresetCollection,
    manifest,
    template,
  })
}
