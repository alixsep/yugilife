import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { tsImport } from "tsx/esm/api"

import { isYugilifeRasterImage, losslessWebpFileName } from "./lossless-webp.mjs"
import { isYugilifeConvertibleFont, woff2FileName } from "./woff2.mjs"

const [{ textTypographies, walkLayers }, templateValidation] = await Promise.all([
  tsImport("../../yugilife-core/src/rendering/layer-tree.js", import.meta.url),
  tsImport("../../yugilife-core/src/template-shape.js", import.meta.url),
])
const {
  validateCardTemplateShape,
  validateColorPresetCollectionShape,
  validateTemplateManifestShape,
} = templateValidation

export const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
export const catalogDirectory = packageDirectory

const catalogFile = path.join(catalogDirectory, "catalog.json")
const developmentPathSegments = new Set(["presets", "references", "reports", "textures"])
const developmentFileNames = new Set(["chromapair-config.json", "report.json"])

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

async function readJson(file, description = catalogRelative(file)) {
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch (error) {
    throw new Error(`Could not parse ${description}: ${error.message}`, { cause: error })
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function assertRelative(file, description) {
  if (typeof file !== "string" || path.isAbsolute(file) || /^[a-z][a-z\d+.-]*:/i.test(file)) {
    throw new Error(`${description} must be a relative path; received "${String(file)}".`)
  }
}

async function assertExactCasing(resolved, description) {
  const relative = path.relative(catalogDirectory, resolved)
  let cursor = catalogDirectory
  for (const segment of relative.split(path.sep)) {
    const names = await readdir(cursor)
    if (!names.includes(segment)) {
      const differentlyCased = names.find(
        (candidate) => candidate.toLocaleLowerCase() === segment.toLocaleLowerCase(),
      )
      throw new Error(
        differentlyCased
          ? `${description} has incorrect filename casing: requested "${segment}", actual filename is "${differentlyCased}".`
          : `${description} does not exist: "${catalogRelative(resolved)}".`,
      )
    }
    cursor = path.join(cursor, segment)
  }
}

async function resolveCatalogFile(templateDirectory, relativePath, description) {
  assertRelative(relativePath, description)
  const resolved = path.resolve(templateDirectory, relativePath)
  const relativeToCatalog = path.relative(catalogDirectory, resolved)
  if (
    relativeToCatalog === "" ||
    relativeToCatalog === ".." ||
    relativeToCatalog.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToCatalog)
  ) {
    throw new Error(`${description} escapes the private asset catalog: "${relativePath}".`)
  }
  await assertExactCasing(resolved, description)
  return resolved
}

function assertRuntimeEligible(file, description) {
  const relative = catalogRelative(file)
  const segments = relative.split(path.sep)
  const forbiddenSegment = segments.find((segment) => developmentPathSegments.has(segment))
  const filename = segments.at(-1)
  if (forbiddenSegment || (filename && developmentFileNames.has(filename))) {
    throw new Error(
      `${description} points to development-only catalog input "${relative}", which cannot be bundled.`,
    )
  }
}

function validateColorPresets(presets, manifest) {
  if (!isRecord(presets) || Object.keys(presets).length === 0) {
    throw new Error(`Template "${manifest.id}" color presets must be a non-empty object.`)
  }
  validateColorPresetCollectionShape(presets, `Template "${manifest.id}" color presets`)
}

function validateCardTemplate(template, manifest) {
  const resolvedTemplate = validateCardTemplateShape(template)
  if (resolvedTemplate.layers.length === 0) {
    throw new Error(`Template "${manifest.id}" must own a non-empty ordered layer list.`)
  }
  const assetIds = new Set(Object.keys(manifest.assets))
  const referencedAssetIds = new Set()
  const assetLayers = new Map()
  for (const mask of resolvedTemplate.masks ?? []) {
    if (!assetIds.has(mask.assetId)) {
      throw new Error(
        `Template "${manifest.id}" canvas mask "${mask.id}" has unresolved semantic asset ID "${String(mask.assetId)}".`,
      )
    }
    referencedAssetIds.add(mask.assetId)
  }
  walkLayers(resolvedTemplate.layers, ({ layer }) => {
    if (["image", "repeated-image", "raster"].includes(layer.kind)) {
      assetLayers.set(layer.id, layer)
    }
    if (layer.assetId !== undefined) {
      if (!assetIds.has(layer.assetId)) {
        throw new Error(
          `Template "${manifest.id}" layer "${layer.id}" has unresolved semantic asset ID "${String(layer.assetId)}".`,
        )
      }
      referencedAssetIds.add(layer.assetId)
    }
    const typographies = layer.kind === "text" ? textTypographies(layer) : []
    for (const typography of typographies) {
      const fontAssetId = typography.fontAssetId
      if (fontAssetId === undefined) continue
      if (typeof fontAssetId !== "string" || !assetIds.has(fontAssetId)) {
        throw new Error(
          `Template "${manifest.id}" layer "${layer.id}" has unresolved font asset ID "${String(fontAssetId)}".`,
        )
      }
      referencedAssetIds.add(fontAssetId)
    }
    if (
      layer.kind === "raster" &&
      layer.renderer !== "color-texture" &&
      layer.renderer !== "color-texture-bevel"
    ) {
      throw new Error(
        `Template "${manifest.id}" raster layer "${layer.id}" uses unavailable core renderer "${String(layer.renderer)}".`,
      )
    }
    if (layer.kind === "canvas" && layer.renderer !== "bevel") {
      throw new Error(
        `Template "${manifest.id}" canvas layer "${layer.id}" uses unavailable core renderer "${String(layer.renderer)}".`,
      )
    }
    if (
      !["image", "repeated-image", "artwork", "raster", "canvas", "text", "svg", "group"].includes(
        layer.kind,
      )
    ) {
      throw new Error(
        `Template "${manifest.id}" layer "${layer.id}" uses unknown core-provided layer kind "${layer.kind}".`,
      )
    }
  })
  for (const rule of resolvedTemplate.presentationRules ?? []) {
    for (const [layerId, assetId] of Object.entries(rule.assetSelections ?? {})) {
      if (!assetLayers.has(layerId)) {
        throw new Error(
          `Template "${manifest.id}" presentation rule "${rule.id}" selects an asset for unknown asset-bearing layer "${layerId}".`,
        )
      }
      if (!assetIds.has(assetId)) {
        throw new Error(
          `Template "${manifest.id}" presentation rule "${rule.id}" has unresolved semantic asset ID "${String(assetId)}".`,
        )
      }
      referencedAssetIds.add(assetId)
    }
  }
  return { referencedAssetIds, resolvedTemplate }
}

function validateTemplatePresetReferences(template, presets, manifest) {
  walkLayers(template.layers, ({ layer }) => {
    if (layer.defaultPreset !== undefined) {
      if (typeof layer.defaultPreset !== "string" || !presets[layer.defaultPreset]) {
        throw new Error(
          `Template "${manifest.id}" layer "${layer.id}" references unknown color preset "${String(layer.defaultPreset)}".`,
        )
      }
    }
    if (layer.presetTarget !== undefined && typeof layer.presetTarget !== "string") {
      throw new Error(`Template "${manifest.id}" layer "${layer.id}" has malformed presetTarget.`)
    }
  })
  for (const rule of template.presentationRules ?? []) {
    for (const [target, presetName] of Object.entries(rule.presets ?? {})) {
      const preset = presets[presetName]
      if (!preset) {
        throw new Error(
          `Template "${manifest.id}" presentation rule "${rule.id}" target "${target}" references unknown color preset "${presetName}".`,
        )
      }
      const presetTarget = preset.metadata?.target
      if (presetTarget !== undefined && presetTarget !== target) {
        throw new Error(
          `Template "${manifest.id}" presentation rule "${rule.id}" target "${target}" references color preset "${presetName}" for target "${presetTarget}".`,
        )
      }
    }
  }
}

function validateManifestShape(manifest, manifestFile) {
  validateTemplateManifestShape(manifest)
  const location = catalogRelative(manifestFile)
  if (manifest.status === undefined) {
    throw new Error(`Catalog template manifest at ${location} must declare a status.`)
  }
  if (!manifest.id.startsWith("card/") && manifest.kind === "card") {
    throw new Error(`Card manifest "${manifest.id}" must use a stable ID beginning with "card/".`)
  }
}

async function discoverManifests() {
  const manifestFiles = await findFiles(path.join(catalogDirectory, "templates"), "manifest.json")
  const manifests = new Map()
  for (const manifestFile of manifestFiles.sort()) {
    const manifest = await readJson(manifestFile)
    validateManifestShape(manifest, manifestFile)
    const existing = manifests.get(manifest.id)
    if (existing) {
      throw new Error(
        `Duplicate template ID "${manifest.id}" in ${catalogRelative(existing.manifestFile)} and ${catalogRelative(manifestFile)}.`,
      )
    }
    manifests.set(manifest.id, { manifest, manifestFile })
  }
  return manifests
}

async function readCatalogPolicy() {
  const policy = await readJson(catalogFile, "yugilife-templates/catalog.json")
  if (
    !isRecord(policy) ||
    !isRecord(policy.defaults) ||
    !Array.isArray(policy.bundledTemplates) ||
    policy.bundledTemplates.some((id) => typeof id !== "string")
  ) {
    throw new Error(
      "yugilife-templates/catalog.json must contain defaults and a bundledTemplates string array.",
    )
  }
  const duplicates = policy.bundledTemplates.filter(
    (id, index) => policy.bundledTemplates.indexOf(id) !== index,
  )
  if (duplicates.length > 0) {
    throw new Error(
      `catalog.json lists bundled template IDs more than once: ${duplicates.join(", ")}.`,
    )
  }
  return policy
}

function validateDependencies(entries) {
  const entriesById = new Map(entries.map((entry) => [entry.manifest.id, entry]))
  const complete = new Set()
  const visit = (id, ancestry) => {
    if (ancestry.includes(id)) {
      throw new Error(`Cyclic template dependency: ${[...ancestry, id].join(" -> ")}.`)
    }
    if (complete.has(id)) return
    const entry = entriesById.get(id)
    if (!entry) {
      throw new Error(
        `Bundled template "${ancestry.at(-1)}" has unresolved or unbundled dependency "${id}".`,
      )
    }
    entry.manifest.templateDependencies?.forEach((dependency) =>
      visit(dependency, [...ancestry, id]),
    )
    complete.add(id)
  }
  entries.forEach((entry) => visit(entry.manifest.id, []))
}

async function loadBundledEntry({ manifest, manifestFile }) {
  if (manifest.kind !== "card") {
    throw new Error(
      `Bundled template "${manifest.id}" has kind "${manifest.kind}", but only the card schema is implemented.`,
    )
  }
  const templateDirectory = path.dirname(manifestFile)
  const templateFile = await resolveCatalogFile(
    templateDirectory,
    manifest.template,
    `Template "${manifest.id}" template path`,
  )
  assertRuntimeEligible(templateFile, `Template "${manifest.id}" template path`)
  const template = await readJson(templateFile)
  const { referencedAssetIds, resolvedTemplate } = validateCardTemplate(template, manifest)

  const unreferencedAssetIds = Object.keys(manifest.assets).filter(
    (assetId) => !referencedAssetIds.has(assetId),
  )
  for (const assetId of unreferencedAssetIds) {
    console.warn(
      `Warning: template "${manifest.id}" declares asset "${assetId}", which no layer references. It is excluded from the runtime bundle.`,
    )
  }

  const bundledAssets = Object.fromEntries(
    Object.entries(manifest.assets).filter(([assetId]) => referencedAssetIds.has(assetId)),
  )

  function runtimeAssetFileName(file) {
    if (isYugilifeRasterImage(file)) {
      return losslessWebpFileName(file)
    }

    if (isYugilifeConvertibleFont(file)) {
      return woff2FileName(file)
    }

    return file
  }

  const assetFiles = {}
  const runtimeAssetPaths = {}
  const runtimeArtifacts = [{ relative: catalogRelative(templateFile), source: templateFile }]
  for (const [assetId, relativePath] of Object.entries(bundledAssets)) {
    if (assetId.length === 0 || typeof relativePath !== "string") {
      throw new Error(`Template "${manifest.id}" has a malformed semantic asset mapping.`)
    }
    const assetFile = await resolveCatalogFile(
      templateDirectory,
      relativePath,
      `Template "${manifest.id}" asset "${assetId}"`,
    )
    assertRuntimeEligible(assetFile, `Template "${manifest.id}" asset "${assetId}"`)
    assetFiles[assetId] = assetFile
    const runtimeAssetFile = runtimeAssetFileName(assetFile)
    const runtimeRelativePath = path
      .relative(templateDirectory, runtimeAssetFile)
      .split(path.sep)
      .join("/")
    runtimeAssetPaths[assetId] = relativePath.startsWith("./")
      ? `./${runtimeRelativePath}`
      : runtimeRelativePath
    runtimeArtifacts.push({
      losslessWebp: isYugilifeRasterImage(assetFile),
      woff2: isYugilifeConvertibleFont(assetFile),
      relative: catalogRelative(runtimeAssetFile),
      source: assetFile,
    })
  }

  const runtimeManifest = {
    ...Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== "status")),
    assets: runtimeAssetPaths,
  }
  runtimeArtifacts.unshift({
    json: runtimeManifest,
    relative: catalogRelative(manifestFile),
  })

  let colorPresets = {}
  let colorPresetsFile
  if (manifest.colorPresets) {
    colorPresetsFile = await resolveCatalogFile(
      templateDirectory,
      manifest.colorPresets,
      `Template "${manifest.id}" color presets`,
    )
    assertRuntimeEligible(colorPresetsFile, `Template "${manifest.id}" color presets`)
    colorPresets = await readJson(colorPresetsFile)
    validateColorPresets(colorPresets, manifest)
    runtimeArtifacts.push({
      relative: catalogRelative(colorPresetsFile),
      source: colorPresetsFile,
    })
  }
  validateTemplatePresetReferences(resolvedTemplate, colorPresets, manifest)
  return {
    assetFiles,
    colorPresets,
    colorPresetsFile,
    manifest,
    manifestFile,
    runtimeArtifacts,
    runtimeManifest,
    template: resolvedTemplate,
    templateFile,
  }
}

export function catalogRelative(file) {
  return path.relative(catalogDirectory, file)
}

export async function loadCatalog() {
  const [manifests, policy] = await Promise.all([discoverManifests(), readCatalogPolicy()])
  if (policy.bundledTemplates.length === 0) {
    throw new Error("catalog.json must explicitly bundle at least one supported template.")
  }
  const selected = policy.bundledTemplates.map((id) => {
    const discovered = manifests.get(id)
    if (!discovered) {
      throw new Error(`catalog.json bundles unknown template ID "${id}".`)
    }
    if (discovered.manifest.status !== "supported") {
      throw new Error(
        `catalog.json cannot bundle template "${id}" with status "${discovered.manifest.status}".`,
      )
    }
    return discovered
  })
  const entries = await Promise.all(selected.map(loadBundledEntry))
  validateDependencies(entries)

  for (const [kind, id] of Object.entries(policy.defaults)) {
    if (typeof id !== "string") {
      throw new Error(`Catalog default "${kind}" must be a template ID string.`)
    }
    const entry = entries.find((candidate) => candidate.manifest.id === id)
    if (!entry) {
      throw new Error(`Catalog default "${kind}" must point to a bundled supported template.`)
    }
    if (kind === "card" && entry.manifest.kind !== "card") {
      throw new Error(`Catalog default "card" points to non-card template "${id}".`)
    }
  }
  if (typeof policy.defaults.card !== "string") {
    throw new Error('catalog.json must declare a bundled supported default for "card".')
  }
  return entries
}

export async function loadCatalogDefaults() {
  const policy = await readCatalogPolicy()
  return policy.defaults
}
