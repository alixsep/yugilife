import type { LayerDefinition, SemanticTextStyle, TextTypography } from "./contracts/index.js"

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function fail(message: string): never {
  throw new Error(`Malformed card template: ${message}`)
}

function namedRecord(value: unknown, location: string): UnknownRecord {
  if (!isRecord(value)) fail(`${location} must be an object.`)
  return value
}

function mergeTypography(base: UnknownRecord, patch: UnknownRecord): UnknownRecord {
  const merged: UnknownRecord = { ...base }
  if (patch["fontFamily"] !== undefined && patch["fontAssetId"] === undefined) {
    delete merged["fontAssetId"]
  }
  if (patch["fitProfileSet"] !== undefined) delete merged["fitProfiles"]
  if (patch["fitProfiles"] !== undefined) delete merged["fitProfileSet"]
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (key === "fitProfileOverrides" && isRecord(value)) {
      const previous = isRecord(merged[key]) ? merged[key] : {}
      merged[key] = { ...previous, ...value }
    } else if (value === null) {
      delete merged[key]
    } else {
      merged[key] = value
    }
  }
  return merged
}

function mergeTypographyPatches(base: UnknownRecord, patch: UnknownRecord): UnknownRecord {
  const merged = mergeTypography(base, patch)
  Object.entries(patch).forEach(([key, value]) => {
    if (value === null) merged[key] = null
  })
  return merged
}

interface NormalizationContext {
  fitProfileSets: UnknownRecord
  fonts: UnknownRecord
  textDefaults: UnknownRecord
  typographyPresets: UnknownRecord
}

function resolveTypography(
  value: unknown,
  context: NormalizationContext,
  location: string,
  allowDeferredProfileOverrides = false,
): TextTypography {
  const authored = namedRecord(value, location)
  const resolved: UnknownRecord = { ...authored }
  const setName = authored["fitProfileSet"]
  if (setName !== undefined) {
    if (typeof setName !== "string" || setName.length === 0) {
      fail(`${location}.fitProfileSet must be a non-empty string.`)
    }
    if (authored["fitProfiles"] !== undefined) {
      fail(`${location} must not declare both fitProfileSet and fitProfiles.`)
    }
    const profileSet = context.fitProfileSets[setName]
    if (!Array.isArray(profileSet)) {
      fail(`${location}.fitProfileSet references unknown set "${setName}".`)
    }
    resolved["fitProfiles"] = profileSet.map((profile) => ({ ...namedRecord(profile, location) }))
  }

  const overrides = authored["fitProfileOverrides"]
  let appliedOverrides = false
  if (overrides !== undefined) {
    const patches = namedRecord(overrides, `${location}.fitProfileOverrides`)
    const profiles = resolved["fitProfiles"]
    if (!Array.isArray(profiles)) {
      if (!allowDeferredProfileOverrides) {
        fail(`${location}.fitProfileOverrides requires fitProfiles or fitProfileSet.`)
      }
    } else {
      appliedOverrides = true
      const seen = new Set<string>()
      resolved["fitProfiles"] = profiles.map((profile, index) => {
        const current = namedRecord(profile, `${location}.fitProfiles[${index}]`)
        const id = current["id"]
        if (typeof id !== "string") return current
        const patch = patches[id]
        if (patch === undefined) return current
        seen.add(id)
        return mergeTypography(current, namedRecord(patch, `${location}.fitProfileOverrides.${id}`))
      })
      for (const id of Object.keys(patches)) {
        if (!seen.has(id)) {
          fail(`${location}.fitProfileOverrides references unknown profile "${id}".`)
        }
      }
    }
  }

  delete resolved["fitProfileSet"]
  if (appliedOverrides) delete resolved["fitProfileOverrides"]

  if (resolved["fitProfiles"] !== undefined) {
    if (resolved["autoScaleXQuantifier"] === undefined) {
      resolved["autoScaleXQuantifier"] = context.textDefaults["autoScaleXQuantifier"]
    }
    if (resolved["maxAutoCompressionX"] === undefined) {
      resolved["maxAutoCompressionX"] = context.textDefaults["maxAutoCompressionX"]
    }
  }

  const family = resolved["fontFamily"]
  if (typeof family === "string" && context.fonts[family] !== undefined) {
    const inheritedAsset = context.fonts[family]
    if (resolved["fontAssetId"] !== undefined && resolved["fontAssetId"] !== inheritedAsset) {
      fail(
        `${location}.fontAssetId conflicts with the asset registered for fontFamily "${family}".`,
      )
    }
    resolved["fontAssetId"] = inheritedAsset
  }
  return resolved as unknown as TextTypography
}

function resolveStyle(
  style: unknown,
  _base: TextTypography,
  context: NormalizationContext,
  location: string,
): SemanticTextStyle {
  const authored = namedRecord(style, location)
  const presetName = authored["typographyPreset"]
  let patch: UnknownRecord = {}
  if (presetName !== undefined) {
    if (typeof presetName !== "string" || presetName.length === 0) {
      fail(`${location}.typographyPreset must be a non-empty string.`)
    }
    const preset = context.typographyPresets[presetName]
    if (!isRecord(preset)) {
      fail(`${location}.typographyPreset references unknown preset "${presetName}".`)
    }
    patch = mergeTypographyPatches(patch, preset)
  }
  if (authored["typography"] !== undefined) {
    patch = mergeTypographyPatches(
      patch,
      namedRecord(authored["typography"], `${location}.typography`),
    )
  }
  if (presetName === undefined && authored["typography"] === undefined) {
    fail(`${location} must declare typographyPreset or typography.`)
  }
  const typography = resolveTypography(patch, context, `${location}.typography`, true)
  const normalized: UnknownRecord = { ...authored, typography }
  delete normalized["typographyPreset"]
  return normalized as unknown as SemanticTextStyle
}

function resolveLayers(
  layers: readonly unknown[],
  context: NormalizationContext,
  location = "layers",
): readonly LayerDefinition[] {
  return layers.map((entry, index) => {
    const layerLocation = `${location}[${index}]`
    const layer = namedRecord(entry, layerLocation)
    if (layer["kind"] === "group" && Array.isArray(layer["layers"])) {
      return {
        ...layer,
        layers: resolveLayers(layer["layers"], context, `${layerLocation}.layers`),
      } as unknown as LayerDefinition
    }
    if (layer["kind"] !== "text") return layer as LayerDefinition
    const typography = resolveTypography(
      layer["typography"],
      context,
      `${layerLocation}.typography`,
    )
    const styles = layer["semanticStyles"]
    return {
      ...layer,
      typography,
      ...(Array.isArray(styles)
        ? {
            semanticStyles: styles.map((style, styleIndex) =>
              resolveStyle(
                style,
                typography,
                context,
                `${layerLocation}.semanticStyles[${styleIndex}]`,
              ),
            ),
          }
        : {}),
    } as unknown as LayerDefinition
  })
}

/** Expands current-schema authoring conveniences into the explicit runtime template contract. */
export function normalizeCardTemplateAuthoring(input: UnknownRecord): UnknownRecord {
  if (input["schemaVersion"] !== 1) return input
  const context: NormalizationContext = {
    fitProfileSets:
      input["fitProfileSets"] === undefined
        ? {}
        : namedRecord(input["fitProfileSets"], "fitProfileSets"),
    fonts: input["fonts"] === undefined ? {} : namedRecord(input["fonts"], "fonts"),
    textDefaults:
      input["textDefaults"] === undefined ? {} : namedRecord(input["textDefaults"], "textDefaults"),
    typographyPresets:
      input["typographyPresets"] === undefined
        ? {}
        : namedRecord(input["typographyPresets"], "typographyPresets"),
  }
  return {
    ...input,
    layers: Array.isArray(input["layers"])
      ? resolveLayers(input["layers"], context)
      : input["layers"],
  }
}
