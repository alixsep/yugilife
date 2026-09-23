import { mergeTextTypography, walkLayers } from "./rendering/layer-tree.js"
import { richTextLineLengths } from "./rich-text.js"
import { normalizeCardTemplateAuthoring } from "./template-normalization.js"

import type {
  CardFieldDefinition,
  CardFieldKind,
  CardFieldValue,
  ColorPreset,
  ColorPresetCollection,
  PolynomialColorPreset,
  SemanticPrimitive,
  SvgElementDefinition,
  TemplateKind,
  TemplateManifest,
  TemplateStatus,
} from "./contracts/index.js"
import type {
  ArtworkLayer,
  CardTemplate,
  LayerDefinition,
  TextFormat,
  TextLayer,
  TextTypography,
} from "./contracts/layers.js"
import type { PresentationOverrides } from "./contracts/presentation.js"

const templateKinds = new Set<string>(["card", "box", "playmat-board", "playmat-field"])
const currentCardTemplateSchemaVersion = 1
const templateStatuses = new Set<string>(["supported", "experimental", "disabled"])
const textFormats = new Set<string>(["plain", "lines", "pair", "type-list"])
const textAnchors = new Set<string>(["start", "middle", "end"])
const textAlignments = new Set<string>(["justify"])
const verticalTextAnchors = new Set<string>(["baseline", "top"])
const textFits = new Set<string>(["font-size", "scale-x"])
const textWraps = new Set<string>(["word"])
const textStrokeAlignments = new Set<string>(["center", "outer"])
const textStrokeLinejoins = new Set<string>(["bevel", "miter", "round"])
const canvasMaskChannels = new Set<string>(["alpha", "luminance"])
const textTypographyKeys = new Set([
  "autoScaleXQuantifier",
  "fill",
  "stroke",
  "fit",
  "fitBlocks",
  "fitProfileOverrides",
  "fitProfileSet",
  "fitProfiles",
  "fontAssetId",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "maxAutoCompressionX",
  "maxHeight",
  "maxWidth",
  "minFontSize",
  "textAlign",
  "textAnchor",
  "verticalAnchor",
  "wrap",
])
const semanticTransformKinds = new Set<string>(["unique-list", "includes", "lookup"])
const semanticFallbackKinds = new Set<string>(["list-length", "value"])
const cardFieldKinds = new Set<string>([
  "text",
  "multiline",
  "number",
  "text-list",
  "number-pair",
  "boolean",
  "image",
])
const manifestKeys = new Set([
  "assets",
  "colorPresets",
  "id",
  "kind",
  "name",
  "status",
  "template",
  "templateDependencies",
  "version",
])
const cardFieldKeys = new Set([
  "automaticFitLayer",
  "automaticWhen",
  "advancedOnly",
  "defaultValue",
  "kind",
  "label",
  "max",
  "maxItems",
  "maxLength",
  "min",
  "name",
  "options",
  "required",
  "suggestions",
])
const cardFieldSuggestionKeys = new Set(["label", "value"])
const layerBaseKeys = ["defaultVisible", "editorVisible", "group", "id", "kind", "label"] as const
const coreLayerKeys: Readonly<Record<string, ReadonlySet<string>>> = {
  artwork: new Set([
    ...layerBaseKeys,
    "field",
    "fit",
    "maskField",
    "maskChannel",
    "placementRegion",
    "region",
    "transformId",
    "transformMode",
  ]),
  canvas: new Set([...layerBaseKeys, "options", "region", "renderer"]),
  group: new Set([...layerBaseKeys, "layers"]),
  image: new Set([...layerBaseKeys, "assetId", "region"]),
  raster: new Set([
    ...layerBaseKeys,
    "assetId",
    "defaultPreset",
    "options",
    "presetTarget",
    "region",
    "renderer",
    "sourceRegion",
  ]),
  "repeated-image": new Set([...layerBaseKeys, "assetId", "field", "offset", "region"]),
  svg: new Set([...layerBaseKeys, "element"]),
  text: new Set([
    ...layerBaseKeys,
    "fallbackField",
    "field",
    "format",
    "pairIndex",
    "position",
    "prefix",
    "semanticPath",
    "semanticStyles",
    "separator",
    "suffix",
    "typography",
  ]),
}
const cardTemplateKeys = new Set([
  "cardFields",
  "dimensions",
  "fitProfileSets",
  "fonts",
  "layers",
  "masks",
  "presentationRules",
  "schemaVersion",
  "semanticBindings",
  "textDefaults",
  "typographyPresets",
])

function isAssetSource(value: unknown) {
  if (typeof value === "string") return true
  if (typeof URL !== "undefined" && value instanceof URL) return true
  if (typeof Blob !== "undefined" && value instanceof Blob) return true
  return (
    typeof value === "object" &&
    value !== null &&
    "width" in value &&
    "height" in value &&
    !Array.isArray(value)
  )
}

function isEmptyValue(value: unknown) {
  if (value === undefined || value === null || value === "") return true
  return (
    Array.isArray(value) &&
    (value.length === 0 || value.every((entry) => entry === "" || entry === undefined))
  )
}

function numericBoundViolation(
  field: CardFieldDefinition,
  value: number,
  subject: string,
): string | undefined {
  if (field.min !== undefined && value < field.min) {
    return `${subject} must be at least ${field.min}`
  }
  if (field.max !== undefined && value > field.max) {
    return `${subject} must be at most ${field.max}`
  }
  return undefined
}

function lengthViolation(
  field: CardFieldDefinition,
  entries: readonly string[],
  entryNoun: string,
  subject: string,
  visibleLengths?: readonly number[],
): string | undefined {
  if (field.maxItems !== undefined && entries.length > field.maxItems) {
    return `${subject} must contain at most ${field.maxItems} ${entryNoun}`
  }
  const maximumLength = field.maxLength
  if (
    maximumLength !== undefined &&
    (visibleLengths ?? entries.flatMap((entry) => richTextLineLengths(entry))).some(
      (length) => length > maximumLength,
    )
  ) {
    return `${subject} must not exceed ${maximumLength} characters`
  }
  return undefined
}

/** Shared runtime and template-default validation for one declared card field. */
export function describeFieldValueViolation(
  field: CardFieldDefinition,
  value: unknown,
  subject = `"${field.name}"`,
  allowEmptyOptional = true,
): string | undefined {
  if (isEmptyValue(value)) {
    if (field.required) return `${subject} is required`
    if (allowEmptyOptional) return undefined
  }
  switch (field.kind) {
    case "boolean":
      return typeof value === "boolean" ? undefined : `${subject} must be a boolean`
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return `${subject} must be a finite number`
      }
      return numericBoundViolation(field, value, subject)
    }
    case "number-pair": {
      if (!Array.isArray(value) || value.length !== 2) {
        return `${subject} must contain exactly two numbers`
      }
      if (value.some((entry) => entry === undefined)) {
        return field.required ? `${subject} must contain exactly two numbers` : undefined
      }
      if (value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) {
        return `${subject} must contain only finite numbers`
      }
      for (const [index, entry] of (value as readonly number[]).entries()) {
        const violation = numericBoundViolation(field, entry, `${subject}[${index}]`)
        if (violation) return violation
      }
      return undefined
    }
    case "text-list": {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
        return `${subject} must be a list of strings`
      }
      if (field.options) {
        const invalid = (value as readonly string[]).find(
          (entry) => !field.options?.includes(entry),
        )
        if (invalid !== undefined) {
          return `${subject} entries must be one of: ${field.options.join(", ")}`
        }
      }
      return lengthViolation(field, value as readonly string[], "entries", subject)
    }
    case "text":
    case "multiline": {
      const lines: readonly unknown[] = Array.isArray(value) ? value : [value]
      if (lines.some((entry) => typeof entry !== "string")) {
        return `${subject} must be text`
      }
      if (field.kind === "text" && Array.isArray(value)) {
        return `${subject} must be a single line of text`
      }
      if (field.options && typeof value === "string" && !field.options.includes(value)) {
        return `${subject} must be one of: ${field.options.join(", ")}`
      }
      const textLines = lines as readonly string[]
      const structuralLines = textLines.flatMap((entry) => entry.split(/\r\n?|\n/gu))
      const visibleLengths =
        field.maxLength === undefined ? undefined : richTextLineLengths(textLines.join("\n"))
      return lengthViolation(field, structuralLines, "lines", subject, visibleLengths)
    }
    case "image":
      return isAssetSource(value) ? undefined : `${subject} must be an image source`
  }
}

/** The exact initial value used by createCardFromTemplate. */
export function initialFieldValue(field: CardFieldDefinition): CardFieldValue {
  if (field.defaultValue !== undefined) return field.defaultValue
  switch (field.kind) {
    case "boolean":
      return false
    case "number":
      return field.min ?? (field.max !== undefined && field.max < 0 ? field.max : 0)
    case "number-pair": {
      const entry = field.min ?? (field.max !== undefined && field.max < 0 ? field.max : 0)
      return [entry, entry]
    }
    case "text-list":
      return []
    case "text":
      return field.options?.[0] ?? ""
    case "multiline":
    case "image":
      return ""
  }
}

const safeSvgTags = new Set([
  "circle",
  "ellipse",
  "g",
  "line",
  "path",
  "polygon",
  "polyline",
  "rect",
  "text",
  "tspan",
])

const safeSvgAttributes = new Set([
  "baseline-shift",
  "cx",
  "cy",
  "d",
  "dominant-baseline",
  "dx",
  "dy",
  "fill",
  "fill-opacity",
  "fill-rule",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "height",
  "id",
  "lengthAdjust",
  "letter-spacing",
  "opacity",
  "points",
  "r",
  "role",
  "rx",
  "ry",
  "stroke",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
  "paint-order",
  "text-anchor",
  "textLength",
  "transform",
  "vector-effect",
  "viewBox",
  "white-space",
  "width",
  "x",
  "x1",
  "x2",
  "y",
  "y1",
  "y2",
  "xml:space",
])

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function fail(message: string): never {
  throw new Error(message)
}

function record(value: unknown, location: string): UnknownRecord {
  if (!isRecord(value)) fail(`${location} must be an object.`)
  return value
}

function nonEmptyString(value: unknown, location: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${location} must be a non-empty string.`)
  }
  return value
}

function finiteNumber(value: unknown, location: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${location} must be a finite number.`)
  }
  return value
}

function positiveNumber(value: unknown, location: string): number {
  const parsed = finiteNumber(value, location)
  if (parsed <= 0) fail(`${location} must be positive.`)
  return parsed
}

function optionalString(value: unknown, location: string): string | undefined {
  return value === undefined ? undefined : nonEmptyString(value, location)
}

function optionalBoolean(value: unknown, location: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "boolean") fail(`${location} must be a boolean.`)
  return value
}

function stringArray(value: unknown, location: string, unique = false): readonly string[] {
  if (!Array.isArray(value)) fail(`${location} must be an array.`)
  const values = value.map((entry, index) => nonEmptyString(entry, `${location}[${index}]`))
  if (unique && new Set(values).size !== values.length) {
    fail(`${location} must contain unique values.`)
  }
  return values
}

function assertNoUnknownKeys(value: UnknownRecord, allowed: ReadonlySet<string>, location: string) {
  const unknownKeys = Object.keys(value).filter((key) => !allowed.has(key))
  if (unknownKeys.length > 0) {
    fail(`${location} has unsupported fields: ${unknownKeys.join(", ")}.`)
  }
}

function relativePath(value: unknown, location: string): string {
  const parsed = nonEmptyString(value, location)
  if (parsed.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(parsed)) {
    fail(`${location} must be relative to its template directory; received "${parsed}".`)
  }
  return parsed
}

function svgAttributeValue(name: string, value: unknown, location: string): string | number {
  if (typeof value !== "string" && typeof value !== "number") {
    fail(`${location}.attributes.${name} must be text or a number.`)
  }
  if (typeof value !== "string") return value
  if (
    [...value].some((character) => {
      const code = character.codePointAt(0)
      return (
        code !== undefined &&
        (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127)
      )
    })
  ) {
    fail(`${location}.attributes.${name} contains unsupported control characters.`)
  }
  if (
    /url\s*\(/i.test(value) ||
    /(?:javascript|data|https?):/i.test(value) ||
    /(?:^|[\s;])@import\b/i.test(value) ||
    /expression\s*\(/i.test(value) ||
    /var\s*\(/i.test(value) ||
    value.includes("\\") ||
    value.includes("/*") ||
    value.includes("*/")
  ) {
    fail(`${location}.attributes.${name} must not contain URL or active CSS content.`)
  }
  return value
}

function region(value: unknown, location: string) {
  const parsed = record(value, location)
  assertNoUnknownKeys(parsed, new Set(["height", "width", "x", "y"]), location)
  return {
    x: finiteNumber(parsed["x"], `${location}.x`),
    y: finiteNumber(parsed["y"], `${location}.y`),
    width: positiveNumber(parsed["width"], `${location}.width`),
    height: positiveNumber(parsed["height"], `${location}.height`),
  }
}

function finiteTuple(value: unknown, length: number, location: string): readonly number[] {
  if (!Array.isArray(value) || value.length !== length) {
    fail(`${location} must contain exactly ${length} finite numbers.`)
  }
  return value.map((entry, index) => finiteNumber(entry, `${location}[${index}]`))
}

function colorPresetMetadata(value: unknown, location: string) {
  if (value === undefined) return
  const metadata = record(value, `${location}.metadata`)
  optionalString(metadata["target"], `${location}.metadata.target`)
}

function polynomialPreset(
  input: UnknownRecord,
  location: string,
): asserts input is UnknownRecord & PolynomialColorPreset {
  const exponents = input["exponents"]
  const coefficients = input["coefficients"]
  if (
    !Array.isArray(exponents) ||
    !Array.isArray(coefficients) ||
    exponents.length === 0 ||
    exponents.length !== coefficients.length
  ) {
    fail(`${location} must contain equally sized exponent and coefficient arrays.`)
  }
  exponents.forEach((tuple, index) => {
    const powers = finiteTuple(tuple, 3, `${location}.exponents[${index}]`)
    if (powers.some((power) => !Number.isInteger(power) || power < 0)) {
      fail(`${location}.exponents[${index}] must contain non-negative integers.`)
    }
  })
  coefficients.forEach((tuple, index) =>
    finiteTuple(tuple, 3, `${location}.coefficients[${index}]`),
  )
}

export function validateColorPresetShape(input: unknown, location = "Color preset"): ColorPreset {
  const preset = record(input, location)
  colorPresetMetadata(preset["metadata"], location)
  const method = preset["method"]
  if (method === "identity") return preset as unknown as ColorPreset
  if (method === "rgb-polynomial") {
    polynomialPreset(preset, location)
    return preset
  }
  if (method === "skimage-histogram-rgb-lut") {
    const channels = record(preset["channels"], `${location}.channels`)
    for (const channel of ["r", "g", "b"] as const) {
      const values = channels[channel]
      if (
        !Array.isArray(values) ||
        values.length !== 256 ||
        values.some(
          (value) =>
            typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 255,
        )
      ) {
        fail(`${location}.channels.${channel} must contain 256 values from 0–255.`)
      }
    }
    return preset as unknown as ColorPreset
  }
  fail(`${location} uses unsupported method ${JSON.stringify(method)}.`)
}

export function validateColorPresetCollectionShape(
  input: unknown,
  location = "Color presets",
): ColorPresetCollection {
  const presets = record(input, location)
  Object.entries(presets).forEach(([name, preset]) =>
    validateColorPresetShape(preset, `${location} "${name}"`),
  )
  return presets as ColorPresetCollection
}

export function validateSvgElementShape(
  input: unknown,
  location = "SVG element",
): SvgElementDefinition {
  const element = record(input, location)
  assertNoUnknownKeys(element, new Set(["attributes", "children", "tag", "text"]), location)
  const tag = element["tag"]
  if (typeof tag !== "string" || !safeSvgTags.has(tag)) {
    fail(`${location}.tag must be a supported inert SVG element; received "${String(tag)}".`)
  }
  if (element["text"] !== undefined && typeof element["text"] !== "string") {
    fail(`${location}.text must be a string.`)
  }
  if (element["attributes"] !== undefined) {
    const attributes = record(element["attributes"], `${location}.attributes`)
    Object.entries(attributes).forEach(([name, value]) => {
      if (/^on/i.test(name)) fail(`${location} must not use event attribute "${name}".`)
      if (name.includes(":") && name !== "xml:space") {
        fail(`${location} must not use namespaced attribute "${name}".`)
      }
      if (!safeSvgAttributes.has(name)) {
        fail(`${location} uses unsupported SVG attribute "${name}".`)
      }
      svgAttributeValue(name, value, location)
      if (name === "xml:space" && value !== "preserve") {
        fail(`${location}.attributes.xml:space must be "preserve".`)
      }
    })
  }
  const children = element["children"]
  if (children !== undefined) {
    if (!Array.isArray(children)) fail(`${location}.children must be an array.`)
    children.forEach((child, index) =>
      validateSvgElementShape(child, `${location}.children[${index}]`),
    )
  }
  return element as unknown as SvgElementDefinition
}

function validateTypography(value: unknown, location: string) {
  const typography = record(value, location)
  assertNoUnknownKeys(typography, textTypographyKeys, location)
  nonEmptyString(typography["fill"], `${location}.fill`)
  if (typography["stroke"] !== undefined) {
    validateTextStroke(typography["stroke"], `${location}.stroke`)
  }
  nonEmptyString(typography["fontFamily"], `${location}.fontFamily`)
  const fit = typography["fit"]
  if (fit !== undefined && (typeof fit !== "string" || !textFits.has(fit))) {
    fail(`${location}.fit is unsupported.`)
  }
  const wrap = typography["wrap"]
  if (wrap !== undefined && (typeof wrap !== "string" || !textWraps.has(wrap))) {
    fail(`${location}.wrap is unsupported.`)
  }
  const fontSize = positiveNumber(typography["fontSize"], `${location}.fontSize`)
  if (typography["autoScaleXQuantifier"] !== undefined) {
    const quantifier = positiveNumber(
      typography["autoScaleXQuantifier"],
      `${location}.autoScaleXQuantifier`,
    )
    if (quantifier > 1) fail(`${location}.autoScaleXQuantifier must not exceed 1.`)
  }
  if (typography["maxAutoCompressionX"] !== undefined) {
    const maximum = finiteNumber(
      typography["maxAutoCompressionX"],
      `${location}.maxAutoCompressionX`,
    )
    if (maximum < 0 || maximum >= 1) {
      fail(`${location}.maxAutoCompressionX must be at least 0 and less than 1.`)
    }
  }
  const fitBlocks = typography["fitBlocks"]
  if (fitBlocks !== undefined) {
    const blocks = record(fitBlocks, `${location}.fitBlocks`)
    assertNoUnknownKeys(blocks, new Set(["leading", "remainder", "split"]), `${location}.fitBlocks`)
    if (blocks["split"] !== "leading-authored-line") {
      fail(`${location}.fitBlocks.split is unsupported.`)
    }
    const leading = record(blocks["leading"], `${location}.fitBlocks.leading`)
    assertNoUnknownKeys(
      leading,
      new Set(["mode", "preferredMaxLines"]),
      `${location}.fitBlocks.leading`,
    )
    if (leading["mode"] !== "prefer-lines") {
      fail(`${location}.fitBlocks.leading.mode is unsupported.`)
    }
    const preferredMaxLines = leading["preferredMaxLines"]
    if (!Number.isInteger(preferredMaxLines) || Number(preferredMaxLines) <= 0) {
      fail(`${location}.fitBlocks.leading.preferredMaxLines must be a positive integer.`)
    }
    const remainder = record(blocks["remainder"], `${location}.fitBlocks.remainder`)
    assertNoUnknownKeys(remainder, new Set(["mode"]), `${location}.fitBlocks.remainder`)
    if (remainder["mode"] !== "layer-fit") {
      fail(`${location}.fitBlocks.remainder.mode is unsupported.`)
    }
  }
  optionalString(typography["fontAssetId"], `${location}.fontAssetId`)
  if (typography["letterSpacing"] !== undefined) {
    finiteNumber(typography["letterSpacing"], `${location}.letterSpacing`)
  }
  if (typography["lineHeight"] !== undefined) {
    positiveNumber(typography["lineHeight"], `${location}.lineHeight`)
  }
  if (typography["maxHeight"] !== undefined) {
    positiveNumber(typography["maxHeight"], `${location}.maxHeight`)
  }
  if (typography["maxWidth"] !== undefined) {
    positiveNumber(typography["maxWidth"], `${location}.maxWidth`)
  }
  if (typography["minFontSize"] !== undefined) {
    const minimum = positiveNumber(typography["minFontSize"], `${location}.minFontSize`)
    if (minimum > fontSize) fail(`${location}.minFontSize must not exceed fontSize.`)
  }
  const fitProfiles = typography["fitProfiles"]
  if (fitProfiles !== undefined) {
    if (!Array.isArray(fitProfiles) || fitProfiles.length === 0) {
      fail(`${location}.fitProfiles must be a non-empty array.`)
    }
    const ids = new Set<string>()
    let previousFontSize = Number.POSITIVE_INFINITY
    fitProfiles.forEach((value, index) => {
      const profileLocation = `${location}.fitProfiles[${index}]`
      const profile = record(value, profileLocation)
      assertNoUnknownKeys(
        profile,
        new Set(["fontSize", "id", "label", "lineHeight", "maxAutoCompressionX", "maxLines"]),
        profileLocation,
      )
      const id = nonEmptyString(profile["id"], `${profileLocation}.id`)
      if (ids.has(id)) fail(`${location}.fitProfiles contains duplicate ID "${id}".`)
      ids.add(id)
      nonEmptyString(profile["label"], `${profileLocation}.label`)
      const profileFontSize = positiveNumber(profile["fontSize"], `${profileLocation}.fontSize`)
      if (profileFontSize > previousFontSize) {
        fail(`${location}.fitProfiles must be ordered from largest font size to smallest.`)
      }
      previousFontSize = profileFontSize
      if (profile["lineHeight"] !== undefined) {
        positiveNumber(profile["lineHeight"], `${profileLocation}.lineHeight`)
      }
      if (profile["maxAutoCompressionX"] !== undefined) {
        const maximum = finiteNumber(
          profile["maxAutoCompressionX"],
          `${profileLocation}.maxAutoCompressionX`,
        )
        if (maximum < 0 || maximum >= 1) {
          fail(`${profileLocation}.maxAutoCompressionX must be at least 0 and less than 1.`)
        }
      }
      if (profile["maxLines"] !== undefined) {
        const maximum = profile["maxLines"]
        if (!Number.isInteger(maximum) || Number(maximum) <= 0) {
          fail(`${profileLocation}.maxLines must be a positive integer.`)
        }
      }
    })
  }
  const fontWeight = typography["fontWeight"]
  if (typeof fontWeight === "number") {
    if (!Number.isFinite(fontWeight) || fontWeight < 1 || fontWeight > 1000) {
      fail(`${location}.fontWeight must be between 1 and 1000.`)
    }
  } else if (typeof fontWeight === "string") {
    if (!["normal", "bold", "bolder", "lighter"].includes(fontWeight)) {
      fail(`${location}.fontWeight uses an unsupported keyword.`)
    }
  } else if (fontWeight !== undefined) {
    fail(`${location}.fontWeight must be text or a number.`)
  }
  const fontStyle = typography["fontStyle"]
  if (fontStyle !== undefined && fontStyle !== "normal" && fontStyle !== "italic") {
    fail(`${location}.fontStyle is unsupported.`)
  }
  const textAnchor = typography["textAnchor"]
  if (
    textAnchor !== undefined &&
    (typeof textAnchor !== "string" || !textAnchors.has(textAnchor))
  ) {
    fail(`${location}.textAnchor is unsupported.`)
  }
  const textAlign = typography["textAlign"]
  if (
    textAlign !== undefined &&
    (typeof textAlign !== "string" || !textAlignments.has(textAlign))
  ) {
    fail(`${location}.textAlign is unsupported.`)
  }
  const verticalAnchor = typography["verticalAnchor"]
  if (
    verticalAnchor !== undefined &&
    (typeof verticalAnchor !== "string" || !verticalTextAnchors.has(verticalAnchor))
  ) {
    fail(`${location}.verticalAnchor is unsupported.`)
  }
}

function validateTextTypographyUsage(typography: UnknownRecord, format: unknown, location: string) {
  if (typography["textAlign"] === "justify") {
    if (format !== "lines" || typography["wrap"] !== "word") {
      fail(`${location}.textAlign "justify" requires multiline word wrapping.`)
    }
    if (typography["maxWidth"] === undefined) {
      fail(`${location}.textAlign "justify" requires maxWidth.`)
    }
  }
  if (typography["fit"] === "scale-x" && format === "lines") {
    fail(`${location}.fit "scale-x" is unsupported for multiline text.`)
  }
  if (typography["fit"] === "scale-x" && typography["minFontSize"] !== undefined) {
    fail(`${location}.minFontSize cannot be used with fit "scale-x".`)
  }
  if (typography["wrap"] !== undefined && format !== "lines") {
    fail(`${location}.wrap requires format "lines".`)
  }
  if (typography["wrap"] !== undefined && typography["maxWidth"] === undefined) {
    fail(`${location}.wrap requires maxWidth.`)
  }
  if (typography["wrap"] !== undefined && typography["fit"] === "scale-x") {
    fail(`${location}.wrap cannot be used with fit "scale-x".`)
  }
  if (typography["fitProfiles"] !== undefined) {
    const isWrappedMultiline = format === "lines" && typography["wrap"] === "word"
    const isSingleLinePreset = format === "type-list" && typography["wrap"] === undefined
    if (!isWrappedMultiline && !isSingleLinePreset) {
      fail(`${location}.fitProfiles requires multiline word wrapping or a type-list text layer.`)
    }
    if (typography["maxWidth"] === undefined) {
      fail(`${location}.fitProfiles requires maxWidth.`)
    }
    if (isWrappedMultiline && typography["fit"] === "scale-x") {
      fail(`${location}.fitProfiles cannot be combined with scale-x fitting for multiline text.`)
    }
    if (typography["minFontSize"] !== undefined) {
      fail(`${location}.fitProfiles cannot be combined with minFontSize fitting.`)
    }
  }
  if (typography["fitBlocks"] !== undefined) {
    if (format !== "lines" || typography["wrap"] !== "word") {
      fail(`${location}.fitBlocks requires multiline word wrapping.`)
    }
    if (typography["fitProfiles"] === undefined) {
      fail(`${location}.fitBlocks requires fitProfiles.`)
    }
  }
  if (typography["autoScaleXQuantifier"] !== undefined && typography["fitProfiles"] === undefined) {
    fail(`${location}.autoScaleXQuantifier requires fitProfiles.`)
  }
  if (typography["maxAutoCompressionX"] !== undefined && typography["fitProfiles"] === undefined) {
    fail(`${location}.maxAutoCompressionX requires fitProfiles.`)
  }
}

function validateTypographyPatch(
  value: unknown,
  baseTypography: TextTypography,
  format: unknown,
  location: string,
) {
  const patch = record(value, location)
  if (Object.keys(patch).length === 0) {
    fail(`${location} must declare at least one typography override.`)
  }
  assertNoUnknownKeys(patch, textTypographyKeys, location)
  if (patch["fitProfileSet"] !== undefined) {
    fail(`${location}.fitProfileSet is only available in template source typography.`)
  }
  const merged = record(mergeTextTypography(baseTypography, patch), location)
  validateTypography(merged, location)
  validateTextTypographyUsage(merged, format, location)
}

function semanticPrimitive(value: unknown, location: string): SemanticPrimitive {
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value
  }
  fail(`${location} must be a boolean, number, or string.`)
}

function semanticPrimitiveArray(value: unknown, location: string): readonly SemanticPrimitive[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${location} must be a non-empty array of booleans, numbers, or strings.`)
  }
  return value.map((entry, index) => semanticPrimitive(entry, `${location}[${index}]`))
}

function validateSemanticCondition(
  value: unknown,
  location: string,
  semanticPaths: ReadonlySet<string>,
) {
  const condition = record(value, location)
  if (condition["all"] !== undefined) {
    assertNoUnknownKeys(condition, new Set(["all"]), location)
    const children = condition["all"]
    if (!Array.isArray(children) || children.length === 0) {
      fail(`${location}.all must be a non-empty array.`)
    }
    children.forEach((child, index) =>
      validateSemanticCondition(child, `${location}.all[${index}]`, semanticPaths),
    )
    return
  }
  if (condition["any"] !== undefined) {
    assertNoUnknownKeys(condition, new Set(["any"]), location)
    const children = condition["any"]
    if (!Array.isArray(children) || children.length === 0) {
      fail(`${location}.any must be a non-empty array.`)
    }
    children.forEach((child, index) =>
      validateSemanticCondition(child, `${location}.any[${index}]`, semanticPaths),
    )
    return
  }
  if (condition["in"] !== undefined) {
    assertNoUnknownKeys(condition, new Set(["in", "path"]), location)
    const path = nonEmptyString(condition["path"], `${location}.path`)
    if (!semanticPaths.has(path)) {
      fail(`${location}.path "${path}" must reference a declared semantic binding.`)
    }
    const values = semanticPrimitiveArray(condition["in"], `${location}.in`)
    if (new Set(values).size !== values.length) {
      fail(`${location}.in must not contain duplicate values.`)
    }
    return
  }
  assertNoUnknownKeys(condition, new Set(["equals", "path"]), location)
  const path = nonEmptyString(condition["path"], `${location}.path`)
  if (!semanticPaths.has(path)) {
    fail(`${location}.path "${path}" must reference a declared semantic binding.`)
  }
  semanticPrimitive(condition["equals"], `${location}.equals`)
}

type SemanticValueKind = "list" | "scalar" | "scalar-or-list"

function semanticFieldKind(field: UnknownRecord, location: string): SemanticValueKind {
  const kind = String(field["kind"])
  if (kind === "text-list" || kind === "number-pair") return "list"
  if (kind === "multiline") return "scalar-or-list"
  if (kind === "text" || kind === "number" || kind === "boolean") return "scalar"
  fail(`${location} must reference a scalar or list card field.`)
}

function validateSemanticSource(
  value: unknown,
  location: string,
  fields: ReadonlyMap<string, UnknownRecord>,
): SemanticValueKind {
  const source = record(value, location)
  assertNoUnknownKeys(source, new Set(["field", "value"]), location)
  const hasField = source["field"] !== undefined
  const hasValue = source["value"] !== undefined
  if (hasField === hasValue) fail(`${location} must declare exactly one of field or value.`)
  if (hasValue) {
    const constant = source["value"]
    if (Array.isArray(constant)) {
      semanticPrimitiveArray(constant, `${location}.value`)
      return "list"
    }
    semanticPrimitive(constant, `${location}.value`)
    return "scalar"
  }
  const fieldName = nonEmptyString(source["field"], `${location}.field`)
  const field = fields.get(fieldName)
  if (!field) fail(`${location}.field references undeclared card field "${fieldName}".`)
  return semanticFieldKind(field, `${location}.field`)
}

function validateSemanticSourceReference(
  value: unknown,
  location: string,
  fields: ReadonlyMap<string, UnknownRecord>,
  semanticPaths: ReadonlyMap<string, SemanticValueKind>,
): SemanticValueKind {
  const source = record(value, location)
  assertNoUnknownKeys(source, new Set(["field", "path"]), location)
  const hasField = source["field"] !== undefined
  const hasPath = source["path"] !== undefined
  if (hasField === hasPath) fail(`${location} must declare exactly one of field or path.`)
  if (hasPath) {
    const path = nonEmptyString(source["path"], `${location}.path`)
    const kind = semanticPaths.get(path)
    if (!kind) {
      fail(`${location}.path "${path}" must reference a declared semantic binding.`)
    }
    return kind
  }
  const fieldName = nonEmptyString(source["field"], `${location}.field`)
  const field = fields.get(fieldName)
  if (!field) fail(`${location}.field references undeclared card field "${fieldName}".`)
  return semanticFieldKind(field, `${location}.field`)
}

function validateSemanticTransform(
  value: unknown,
  location: string,
  sourceKind: SemanticValueKind,
): SemanticValueKind {
  const transform = record(value, location)
  assertNoUnknownKeys(transform, new Set(["kind", "value", "values"]), location)
  const kind = nonEmptyString(transform["kind"], `${location}.kind`)
  if (!semanticTransformKinds.has(kind)) {
    fail(`${location}.kind "${kind}" is unsupported.`)
  }
  if (kind === "includes") {
    if (sourceKind !== "list") {
      fail(`${location} kind "includes" requires a list source.`)
    }
    nonEmptyString(transform["value"], `${location}.value`)
    return "scalar"
  }
  if (kind === "lookup") {
    if (sourceKind !== "scalar") {
      fail(`${location} kind "lookup" requires a scalar source.`)
    }
    if (transform["value"] !== undefined) {
      fail(`${location}.value is not allowed for lookup.`)
    }
    const values = record(transform["values"], `${location}.values`)
    if (Object.keys(values).length === 0) {
      fail(`${location}.values must not be empty.`)
    }
    Object.entries(values).forEach(([key, mappedValue]) => {
      if (key.length === 0) fail(`${location}.values contains an empty source key.`)
      semanticPrimitive(mappedValue, `${location}.values.${key}`)
    })
    return "scalar"
  }
  if (sourceKind !== "list") {
    fail(`${location} kind "unique-list" requires a list source.`)
  }
  if (transform["values"] !== undefined) {
    fail(`${location}.values is not allowed for ${kind}.`)
  }
  if (transform["value"] !== undefined) fail(`${location}.value is not allowed for unique-list.`)
  return "list"
}

function validateSemanticFallback(
  value: unknown,
  location: string,
  fields: ReadonlyMap<string, UnknownRecord>,
  semanticPaths: ReadonlyMap<string, SemanticValueKind>,
): SemanticValueKind {
  const fallback = record(value, location)
  assertNoUnknownKeys(fallback, new Set(["kind", "minimum", "source", "value"]), location)
  const kind = nonEmptyString(fallback["kind"], `${location}.kind`)
  if (!semanticFallbackKinds.has(kind)) {
    fail(`${location}.kind "${kind}" is unsupported.`)
  }
  if (kind === "value") {
    if (fallback["minimum"] !== undefined || fallback["source"] !== undefined) {
      fail(`${location} value fallbacks may only declare kind and value.`)
    }
    semanticPrimitive(fallback["value"], `${location}.value`)
    return "scalar"
  }
  if (fallback["value"] !== undefined)
    fail(`${location}.value is only allowed for value fallbacks.`)
  if (fallback["minimum"] !== undefined) finiteNumber(fallback["minimum"], `${location}.minimum`)
  const sourceKind = validateSemanticSourceReference(
    fallback["source"],
    `${location}.source`,
    fields,
    semanticPaths,
  )
  if (sourceKind !== "list") {
    fail(`${location}.source must reference a list value.`)
  }
  return "scalar"
}

function validateSemanticBindings(
  value: unknown,
  fields: ReadonlyMap<string, UnknownRecord>,
): ReadonlyMap<string, SemanticValueKind> {
  const location = "semanticBindings"
  const bindingsContainer = record(value, location)
  assertNoUnknownKeys(bindingsContainer, new Set(["bindings"]), location)
  const bindings = bindingsContainer["bindings"]
  if (!Array.isArray(bindings) || bindings.length === 0) {
    fail(`${location}.bindings must be a non-empty array.`)
  }
  const semanticPaths = new Set<string>()
  bindings.forEach((entry, index) => {
    const binding = record(entry, `${location}[${index}]`)
    assertNoUnknownKeys(
      binding,
      new Set(["fallback", "fallbackValues", "path", "source", "transform", "when"]),
      `${location}[${index}]`,
    )
    const path = nonEmptyString(binding["path"], `${location}[${index}].path`)
    if (semanticPaths.has(path)) fail(`${location} contains duplicate path "${path}".`)
    semanticPaths.add(path)
  })

  const availablePaths = new Map<string, SemanticValueKind>()
  bindings.forEach((entry, index) => {
    const binding = record(entry, `${location}[${index}]`)
    const bindingLocation = `${location}[${index}]`
    const sourceKind = validateSemanticSource(
      binding["source"],
      `${bindingLocation}.source`,
      fields,
    )
    if (binding["fallback"] !== undefined) {
      const fallbackKind = validateSemanticFallback(
        binding["fallback"],
        `${bindingLocation}.fallback`,
        fields,
        availablePaths,
      )
      if (fallbackKind !== sourceKind) {
        fail(
          `${bindingLocation}.fallback produces a ${fallbackKind} value but its source is ${sourceKind}.`,
        )
      }
    }
    if (binding["fallbackValues"] !== undefined) {
      if (sourceKind !== "scalar") {
        fail(`${bindingLocation}.fallbackValues requires a scalar source.`)
      }
      semanticPrimitiveArray(binding["fallbackValues"], `${bindingLocation}.fallbackValues`)
    }
    if (binding["when"] !== undefined) {
      validateSemanticCondition(
        binding["when"],
        `${bindingLocation}.when`,
        new Set(availablePaths.keys()),
      )
    }
    const outputKind =
      binding["transform"] === undefined
        ? sourceKind
        : validateSemanticTransform(
            binding["transform"],
            `${bindingLocation}.transform`,
            sourceKind,
          )
    availablePaths.set(String(binding["path"]), outputKind)
  })
  return availablePaths
}

function validateLayer(
  value: unknown,
  location: string,
  ids: Set<string>,
  fields: ReadonlyMap<string, UnknownRecord>,
  textLayerIds: Set<string>,
  assetLayerIds: Set<string>,
  optionsLayerIds: Set<string>,
  nonMaskableLayerIds: Set<string>,
  regionLayerIds: Set<string>,
  semanticPaths: ReadonlySet<string>,
  transformIds: ReadonlySet<string>,
) {
  const layer = record(value, location)
  const id = nonEmptyString(layer["id"], `${location}.id`)
  const kind = nonEmptyString(layer["kind"], `${location}.kind`)
  const allowedKeys = Object.hasOwn(coreLayerKeys, kind) ? coreLayerKeys[kind] : undefined
  if (allowedKeys) assertNoUnknownKeys(layer, allowedKeys, location)
  optionalString(layer["label"], `${location}.label`)
  optionalString(layer["group"], `${location}.group`)
  optionalBoolean(layer["defaultVisible"], `${location}.defaultVisible`)
  optionalBoolean(layer["editorVisible"], `${location}.editorVisible`)
  if (ids.has(id)) fail(`Duplicate layer ID "${id}" at ${location}.`)
  ids.add(id)
  if (kind === "text") textLayerIds.add(id)
  if (["image", "repeated-image", "raster"].includes(kind)) assetLayerIds.add(id)
  if (["artwork", "canvas", "image", "raster", "repeated-image"].includes(kind)) {
    regionLayerIds.add(id)
  }
  if (kind === "raster" || kind === "canvas") optionsLayerIds.add(id)
  if (["text", "svg"].includes(kind)) nonMaskableLayerIds.add(id)

  const referencedField = (name: unknown, fieldLocation: string) => {
    const field = nonEmptyString(name, fieldLocation)
    const definition = fields.get(field)
    if (!definition) {
      fail(
        `${fieldLocation} references card field "${field}", which the template does not declare.`,
      )
    }
    return definition
  }

  if (["image", "repeated-image", "artwork", "raster", "canvas"].includes(kind)) {
    region(layer["region"], `${location}.region`)
  }
  if (kind === "image" || kind === "repeated-image") {
    nonEmptyString(layer["assetId"], `${location}.assetId`)
  }
  if (kind === "repeated-image") {
    const field = referencedField(layer["field"], `${location}.field`)
    if (field["kind"] !== "number") {
      fail(`${location}.field must reference a number field.`)
    }
    const offset = record(layer["offset"], `${location}.offset`)
    assertNoUnknownKeys(offset, new Set(["x", "y"]), `${location}.offset`)
    finiteNumber(offset["x"], `${location}.offset.x`)
    finiteNumber(offset["y"], `${location}.offset.y`)
  }
  if (kind === "artwork") {
    const field = referencedField(layer["field"], `${location}.field`)
    if (field["kind"] !== "image") {
      fail(`${location}.field must reference an image field.`)
    }
    const fit = layer["fit"]
    if (fit !== undefined && fit !== "stretch" && fit !== "width") {
      fail(`${location}.fit must be "stretch" or "width".`)
    }
    if (layer["maskField"] !== undefined) {
      const maskField = referencedField(layer["maskField"], `${location}.maskField`)
      if (maskField["kind"] !== "image") {
        fail(`${location}.maskField must reference an image field.`)
      }
    }
    if (
      layer["maskChannel"] !== undefined &&
      layer["maskChannel"] !== "alpha" &&
      layer["maskChannel"] !== "luminance"
    ) {
      fail(`${location}.maskChannel must be "alpha" or "luminance".`)
    }
    if (layer["placementRegion"] !== undefined) {
      region(layer["placementRegion"], `${location}.placementRegion`)
    }
    optionalString(layer["transformId"], `${location}.transformId`)
    if (layer["transformMode"] !== undefined) {
      nonEmptyString(layer["transformMode"], `${location}.transformMode`)
    }
  }
  if (kind === "raster" || kind === "canvas") {
    nonEmptyString(layer["renderer"], `${location}.renderer`)
    if (layer["options"] !== undefined) record(layer["options"], `${location}.options`)
  }
  if (kind === "raster") {
    optionalString(layer["assetId"], `${location}.assetId`)
    optionalString(layer["defaultPreset"], `${location}.defaultPreset`)
    optionalString(layer["presetTarget"], `${location}.presetTarget`)
    if (layer["sourceRegion"] !== undefined) {
      region(layer["sourceRegion"], `${location}.sourceRegion`)
    }
  }
  if (kind === "text") {
    const semanticPathValue = layer["semanticPath"]
    let sourceField: UnknownRecord | undefined
    if (layer["field"] !== undefined) {
      sourceField = referencedField(layer["field"], `${location}.field`)
      if (sourceField["kind"] === "image") {
        fail(`${location}.field must reference a text-serializable field.`)
      }
    } else if (semanticPathValue === undefined) {
      fail(`${location} must declare field or semanticPath.`)
    }
    if (layer["fallbackField"] !== undefined) {
      const fallbackField = referencedField(layer["fallbackField"], `${location}.fallbackField`)
      if (fallbackField["kind"] === "image") {
        fail(`${location}.fallbackField must reference a text-serializable field.`)
      }
    }
    optionalString(layer["prefix"], `${location}.prefix`)
    optionalString(layer["separator"], `${location}.separator`)
    optionalString(layer["suffix"], `${location}.suffix`)
    if (semanticPathValue !== undefined) {
      const semanticPath = nonEmptyString(semanticPathValue, `${location}.semanticPath`)
      if (!semanticPaths.has(semanticPath)) {
        fail(
          `${location}.semanticPath "${semanticPath}" must reference a declared semantic binding.`,
        )
      }
    }
    const format = layer["format"]
    if (format !== undefined && (typeof format !== "string" || !textFormats.has(format))) {
      fail(`${location}.format is unsupported.`)
    }
    if (format === "pair" && sourceField?.["kind"] !== "number-pair") {
      fail(`${location}.format "pair" requires a number-pair field.`)
    }
    if (format === "type-list" && sourceField?.["kind"] !== "text-list") {
      fail(`${location}.format "type-list" requires a text-list field.`)
    }
    const pairIndex = layer["pairIndex"]
    if (pairIndex !== undefined) {
      if (format !== "pair") fail(`${location}.pairIndex requires format "pair".`)
      if (pairIndex !== 0 && pairIndex !== 1) {
        fail(`${location}.pairIndex must be 0 or 1.`)
      }
    }
    const position = record(layer["position"], `${location}.position`)
    assertNoUnknownKeys(position, new Set(["x", "y"]), `${location}.position`)
    finiteNumber(position["x"], `${location}.position.x`)
    finiteNumber(position["y"], `${location}.position.y`)
    validateTypography(layer["typography"], `${location}.typography`)
    const typography = record(layer["typography"], `${location}.typography`)
    validateTextTypographyUsage(typography, format, `${location}.typography`)
    const semanticStyles = layer["semanticStyles"]
    if (semanticStyles !== undefined) {
      if (!Array.isArray(semanticStyles) || semanticStyles.length === 0) {
        fail(`${location}.semanticStyles must be a non-empty array.`)
      }
      const styleIds = new Set<string>()
      semanticStyles.forEach((value, index) => {
        const styleLocation = `${location}.semanticStyles[${index}]`
        const style = record(value, styleLocation)
        assertNoUnknownKeys(
          style,
          new Set(["id", "label", "typography", "when", "whenTransforms"]),
          styleLocation,
        )
        const styleId = nonEmptyString(style["id"], `${styleLocation}.id`)
        if (styleIds.has(styleId)) {
          fail(`${location}.semanticStyles contains duplicate ID "${styleId}".`)
        }
        styleIds.add(styleId)
        nonEmptyString(style["label"], `${styleLocation}.label`)
        if (style["when"] === undefined && style["whenTransforms"] === undefined) {
          fail(`${styleLocation} must declare when or whenTransforms.`)
        }
        if (style["when"] !== undefined) {
          validateSemanticCondition(style["when"], `${styleLocation}.when`, semanticPaths)
        }
        if (style["whenTransforms"] !== undefined) {
          validateTransformModeGate(
            style["whenTransforms"],
            `${styleLocation}.whenTransforms`,
            transformIds,
          )
        }
        validateTypographyPatch(
          style["typography"],
          typography as unknown as TextTypography,
          format,
          `${styleLocation}.typography`,
        )
      })
    }
  }
  if (kind === "svg") validateSvgElementShape(layer["element"], `${location}.element`)
  if (kind === "group") {
    const layers = layer["layers"]
    if (!Array.isArray(layers)) fail(`${location}.layers must be an array.`)
    layers.forEach((child, index) =>
      validateLayer(
        child,
        `${location}.layers[${index}]`,
        ids,
        fields,
        textLayerIds,
        assetLayerIds,
        optionsLayerIds,
        nonMaskableLayerIds,
        regionLayerIds,
        semanticPaths,
        transformIds,
      ),
    )
  }
}

function validateCanvasMasks(value: unknown): ReadonlyMap<string, string | undefined> {
  const location = "masks"
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${location} must be a non-empty array.`)
  }
  const masks = new Map<string, string | undefined>()
  value.forEach((entry, index) => {
    const maskLocation = `${location}[${index}]`
    const mask = record(entry, maskLocation)
    assertNoUnknownKeys(
      mask,
      new Set(["assetId", "channel", "coverageLayerId", "id", "invert"]),
      maskLocation,
    )
    const id = nonEmptyString(mask["id"], `${maskLocation}.id`)
    if (masks.has(id)) fail(`${location} contains duplicate ID "${id}".`)
    const coverageLayerId =
      mask["coverageLayerId"] === undefined
        ? undefined
        : nonEmptyString(mask["coverageLayerId"], `${maskLocation}.coverageLayerId`)
    masks.set(id, coverageLayerId)
    nonEmptyString(mask["assetId"], `${maskLocation}.assetId`)
    const channel = mask["channel"]
    if (
      channel !== undefined &&
      (typeof channel !== "string" || !canvasMaskChannels.has(channel))
    ) {
      fail(`${maskLocation}.channel must be "alpha" or "luminance".`)
    }
    optionalBoolean(mask["invert"], `${maskLocation}.invert`)
  })
  return masks
}

/**
 * A coverage-scoped mask consults the already-rendered alpha of another layer, so that layer must
 * render strictly before every layer the mask targets. `assertLayerTree` enforces this again on the
 * resolved presentation at render time; checking it during validation rejects an unusable template
 * or override at its ingestion boundary instead of at the consumer's first render.
 */
function assertCoverageRendersFirst(
  maskId: string,
  layerId: string,
  location: string,
  coverageLayerIds: ReadonlyMap<string, string | undefined>,
  layerOrder: ReadonlyMap<string, number>,
) {
  const coverageLayerId = coverageLayerIds.get(maskId)
  if (coverageLayerId === undefined) return
  const coverageOrder = layerOrder.get(coverageLayerId)
  const targetOrder = layerOrder.get(layerId)
  if (coverageOrder === undefined || targetOrder === undefined) return
  if (coverageOrder >= targetOrder) {
    fail(
      `${location} assigns mask "${maskId}" to layer "${layerId}", but its coverage layer "${coverageLayerId}" does not render before that layer.`,
    )
  }
}

/** Layer IDs in render order; both validation walks visit parents before their children. */
function layerRenderOrder(layerIds: Iterable<string>) {
  return new Map([...layerIds].map((id, index) => [id, index] as const))
}

/**
 * Shared artwork transform IDs, collected before layer validation so a semantic style or
 * presentation rule can reference a transform declared by a later layer. Malformed layers are
 * skipped here and rejected by ordinary layer validation.
 */
function collectArtworkTransformIds(layers: unknown, into = new Set<string>()) {
  if (!Array.isArray(layers)) return into
  layers.forEach((value) => {
    if (!isRecord(value)) return
    if (value["kind"] === "artwork") {
      const transformId = value["transformId"] ?? value["id"]
      if (typeof transformId === "string" && transformId.length > 0) into.add(transformId)
    }
    if (value["kind"] === "group") collectArtworkTransformIds(value["layers"], into)
  })
  return into
}

/**
 * Validates a presentation-only gate on resolved artwork transform modes. Presentation may read
 * transform modes but never assigns them, so this gate cannot introduce a resolution cycle.
 */
function validateTransformModeGate(
  value: unknown,
  location: string,
  transformIds: ReadonlySet<string>,
) {
  const gate = record(value, location)
  if (Object.keys(gate).length === 0) fail(`${location} must not be empty.`)
  Object.entries(gate).forEach(([transformId, mode]) => {
    if (!transformIds.has(transformId)) {
      fail(`${location} references unknown artwork transform "${transformId}".`)
    }
    if (mode === null) return
    nonEmptyString(mode, `${location}.${transformId}`)
  })
}

/**
 * Stroke is painted, never measured, so it is deliberately excluded from every fitting and wrapping
 * constraint: no stroke value can change which fit profile the renderer selects.
 */
function validateTextStroke(value: unknown, location: string) {
  const stroke = record(value, location)
  assertNoUnknownKeys(stroke, new Set(["align", "color", "linejoin", "opacity", "width"]), location)
  nonEmptyString(stroke["color"], `${location}.color`)
  positiveNumber(stroke["width"], `${location}.width`)
  if (stroke["align"] !== undefined && !textStrokeAlignments.has(stroke["align"] as string)) {
    fail(`${location}.align must be "center" or "outer".`)
  }
  if (stroke["linejoin"] !== undefined && !textStrokeLinejoins.has(stroke["linejoin"] as string)) {
    fail(`${location}.linejoin must be "bevel", "miter", or "round".`)
  }
  if (stroke["opacity"] !== undefined) {
    const opacity = finiteNumber(stroke["opacity"], `${location}.opacity`)
    if (opacity < 0 || opacity > 1) fail(`${location}.opacity must be between 0 and 1.`)
  }
}

function validateCardField(value: unknown, location: string, names: Set<string>) {
  const field = record(value, location)
  assertNoUnknownKeys(field, cardFieldKeys, location)
  const name = nonEmptyString(field["name"], `${location}.name`)
  if (names.has(name)) fail(`Duplicate card field "${name}" at ${location}.`)
  names.add(name)
  const kind = nonEmptyString(field["kind"], `${location}.kind`)
  if (!cardFieldKinds.has(kind)) {
    fail(`${location}.kind "${kind}" is unsupported.`)
  }
  nonEmptyString(field["label"], `${location}.label`)
  if (field["automaticFitLayer"] !== undefined) {
    nonEmptyString(field["automaticFitLayer"], `${location}.automaticFitLayer`)
  }
  optionalBoolean(field["advancedOnly"], `${location}.advancedOnly`)
  optionalBoolean(field["required"], `${location}.required`)

  const numericBound = (key: "min" | "max") => {
    if (field[key] !== undefined) finiteNumber(field[key], `${location}.${key}`)
  }
  if (kind === "number" || kind === "number-pair") {
    numericBound("min")
    numericBound("max")
    const min = field["min"]
    const max = field["max"]
    if (typeof min === "number" && typeof max === "number" && min > max) {
      fail(`${location}.min must not exceed ${location}.max.`)
    }
  } else if (field["min"] !== undefined || field["max"] !== undefined) {
    fail(`${location} may only use min and max on numeric fields.`)
  }

  if (field["maxLength"] !== undefined) {
    if (kind !== "text" && kind !== "multiline" && kind !== "text-list") {
      fail(`${location}.maxLength only applies to text fields.`)
    }
    positiveNumber(field["maxLength"], `${location}.maxLength`)
  }
  if (field["maxItems"] !== undefined) {
    if (kind !== "text-list" && kind !== "multiline") {
      fail(`${location}.maxItems only applies to list fields.`)
    }
    positiveNumber(field["maxItems"], `${location}.maxItems`)
  }
  if (field["options"] !== undefined) {
    if (kind !== "text" && kind !== "text-list") {
      fail(`${location}.options only applies to text and text-list fields.`)
    }
    const options = stringArray(field["options"], `${location}.options`, true)
    if (options.length === 0) fail(`${location}.options must not be empty.`)
  }
  if (field["suggestions"] !== undefined) {
    if (kind !== "text") fail(`${location}.suggestions only applies to text fields.`)
    if (field["options"] !== undefined) {
      fail(`${location} cannot declare both options and suggestions.`)
    }
    if (!Array.isArray(field["suggestions"]) || field["suggestions"].length === 0) {
      fail(`${location}.suggestions must be a non-empty array.`)
    }
    const values = new Set<string>()
    field["suggestions"].forEach((value, index) => {
      const suggestionLocation = `${location}.suggestions[${index}]`
      const suggestion = record(value, suggestionLocation)
      assertNoUnknownKeys(suggestion, cardFieldSuggestionKeys, suggestionLocation)
      const suggestionValue = nonEmptyString(suggestion["value"], `${suggestionLocation}.value`)
      if (values.has(suggestionValue)) {
        fail(`${location}.suggestions contains duplicate value ${JSON.stringify(suggestionValue)}.`)
      }
      values.add(suggestionValue)
      if (suggestion["label"] !== undefined) {
        nonEmptyString(suggestion["label"], `${suggestionLocation}.label`)
      }
    })
  }

  const defaultValue = field["defaultValue"]
  const parsed = field as unknown as CardFieldDefinition
  const initialViolation = describeFieldValueViolation(
    parsed,
    initialFieldValue(parsed),
    defaultValue === undefined ? location : `${location}.defaultValue`,
    false,
  )
  if (initialViolation) fail(`${initialViolation}.`)
  return parsed
}

function collectTextLayerRecords(
  layers: readonly unknown[],
  result = new Map<string, UnknownRecord>(),
) {
  layers.forEach((value) => {
    if (!isRecord(value)) return
    if (value["kind"] === "text" && typeof value["id"] === "string") {
      result.set(value["id"], value)
    }
    if (Array.isArray(value["layers"])) collectTextLayerRecords(value["layers"], result)
  })
  return result
}

function validateAutomaticFitLayers(cardFields: readonly unknown[], layers: readonly unknown[]) {
  const textLayers = collectTextLayerRecords(layers)
  cardFields.forEach((value, index) => {
    const field = record(value, `cardFields[${index}]`)
    const layerIdValue = field["automaticFitLayer"]
    if (layerIdValue === undefined) return
    const layerId = nonEmptyString(layerIdValue, `cardFields[${index}].automaticFitLayer`)
    const layer = textLayers.get(layerId)
    if (!layer) {
      fail(`cardFields[${index}].automaticFitLayer references unknown text layer "${layerId}".`)
    }
    if (layer["field"] !== field["name"]) {
      fail(
        `cardFields[${index}].automaticFitLayer must reference a text layer sourced from field "${String(field["name"])}".`,
      )
    }
    const typography = record(layer["typography"], `Text layer "${layerId}" typography`)
    const styles = Array.isArray(layer["semanticStyles"]) ? layer["semanticStyles"] : []
    const hasProfiles =
      Array.isArray(typography["fitProfiles"]) ||
      styles.some(
        (style) =>
          isRecord(style) &&
          isRecord(style["typography"]) &&
          Array.isArray(style["typography"]["fitProfiles"]),
      )
    if (!hasProfiles) {
      fail(`cardFields[${index}].automaticFitLayer must reference a text layer with fit profiles.`)
    }
  })
}

function validateAutomaticWhen(
  value: unknown,
  location: string,
  semanticPaths: ReadonlySet<string>,
) {
  if (value === undefined) return
  const conditions = Array.isArray(value) ? value : [value]
  if (conditions.length === 0) fail(`${location} must not be empty.`)
  conditions.forEach((condition, index) => {
    validateSemanticCondition(
      condition,
      Array.isArray(value) ? `${location}[${index}]` : location,
      semanticPaths,
    )
  })
}

function validateSemanticPresentationRules(
  value: unknown,
  layerIds: ReadonlySet<string>,
  textLayerIds: ReadonlySet<string>,
  assetLayerIds: ReadonlySet<string>,
  optionsLayerIds: ReadonlySet<string>,
  nonMaskableLayerIds: ReadonlySet<string>,
  regionLayerIds: ReadonlySet<string>,
  maskIds: ReadonlySet<string>,
  semanticPaths: ReadonlySet<string>,
  transformIds: ReadonlySet<string>,
) {
  const location = "presentationRules"
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${location} must be a non-empty array.`)
  }
  const ids = new Set<string>()
  value.forEach((entry, index) => {
    const ruleLocation = `${location}[${index}]`
    const rule = record(entry, ruleLocation)
    assertNoUnknownKeys(
      rule,
      new Set([
        "assetSelections",
        "id",
        "layerVisibility",
        "layerRegions",
        "layerOptions",
        "maskSelections",
        "presets",
        "textPositions",
        "textValues",
        "when",
        "whenTransforms",
      ]),
      ruleLocation,
    )
    const id = nonEmptyString(rule["id"], `${ruleLocation}.id`)
    if (ids.has(id)) fail(`${location} contains duplicate ID "${id}".`)
    ids.add(id)
    if (rule["when"] === undefined && rule["whenTransforms"] === undefined) {
      fail(`${ruleLocation} must declare when or whenTransforms.`)
    }
    if (rule["when"] !== undefined) {
      validateSemanticCondition(rule["when"], `${ruleLocation}.when`, semanticPaths)
    }
    if (rule["whenTransforms"] !== undefined) {
      validateTransformModeGate(
        rule["whenTransforms"],
        `${ruleLocation}.whenTransforms`,
        transformIds,
      )
    }

    const layerVisibility = rule["layerVisibility"]
    const layerRegions = rule["layerRegions"]
    const layerOptions = rule["layerOptions"]
    const maskSelections = rule["maskSelections"]
    const assetSelections = rule["assetSelections"]
    const presets = rule["presets"]
    const textPositions = rule["textPositions"]
    const textValues = rule["textValues"]
    if (
      layerVisibility === undefined &&
      layerRegions === undefined &&
      layerOptions === undefined &&
      maskSelections === undefined &&
      assetSelections === undefined &&
      presets === undefined &&
      textPositions === undefined &&
      textValues === undefined
    ) {
      fail(
        `${ruleLocation} must declare assetSelections, layerOptions, layerRegions, layerVisibility, maskSelections, presets, textPositions, or textValues.`,
      )
    }
    if (maskSelections !== undefined) {
      const selections = record(maskSelections, `${ruleLocation}.maskSelections`)
      if (Object.keys(selections).length === 0) {
        fail(`${ruleLocation}.maskSelections must not be empty.`)
      }
      Object.entries(selections).forEach(([layerId, maskId]) => {
        const parsedMaskId = nonEmptyString(maskId, `${ruleLocation}.maskSelections.${layerId}`)
        if (!layerIds.has(layerId)) {
          fail(`${ruleLocation}.maskSelections references unknown layer "${layerId}".`)
        }
        if (nonMaskableLayerIds.has(layerId)) {
          fail(`${ruleLocation}.maskSelections target "${layerId}" is not a raster-output layer.`)
        }
        if (!maskIds.has(parsedMaskId)) {
          fail(
            `${ruleLocation}.maskSelections.${layerId} references unknown mask "${parsedMaskId}".`,
          )
        }
      })
    }
    if (assetSelections !== undefined) {
      const selections = record(assetSelections, `${ruleLocation}.assetSelections`)
      if (Object.keys(selections).length === 0) {
        fail(`${ruleLocation}.assetSelections must not be empty.`)
      }
      Object.entries(selections).forEach(([layerId, assetId]) => {
        if (!assetLayerIds.has(layerId)) {
          fail(
            `${ruleLocation}.assetSelections references unknown asset-bearing layer "${layerId}".`,
          )
        }
        nonEmptyString(assetId, `${ruleLocation}.assetSelections.${layerId}`)
      })
    }
    if (layerVisibility !== undefined) {
      const visibility = record(layerVisibility, `${ruleLocation}.layerVisibility`)
      if (Object.keys(visibility).length === 0) {
        fail(`${ruleLocation}.layerVisibility must not be empty.`)
      }
      Object.entries(visibility).forEach(([layerId, visible]) => {
        if (!layerIds.has(layerId)) {
          fail(`${ruleLocation}.layerVisibility references unknown layer "${layerId}".`)
        }
        if (typeof visible !== "boolean") {
          fail(`${ruleLocation}.layerVisibility.${layerId} must be a boolean.`)
        }
      })
    }
    if (layerRegions !== undefined) {
      const selections = record(layerRegions, `${ruleLocation}.layerRegions`)
      if (Object.keys(selections).length === 0) {
        fail(`${ruleLocation}.layerRegions must not be empty.`)
      }
      Object.entries(selections).forEach(([layerId, selectedRegion]) => {
        if (!regionLayerIds.has(layerId)) {
          fail(`${ruleLocation}.layerRegions references non-region layer "${layerId}".`)
        }
        region(selectedRegion, `${ruleLocation}.layerRegions.${layerId}`)
      })
    }
    if (layerOptions !== undefined) {
      const options = record(layerOptions, `${ruleLocation}.layerOptions`)
      if (Object.keys(options).length === 0) {
        fail(`${ruleLocation}.layerOptions must not be empty.`)
      }
      Object.entries(options).forEach(([layerId, patch]) => {
        if (!optionsLayerIds.has(layerId)) {
          fail(
            `${ruleLocation}.layerOptions references layer "${layerId}" without renderer options.`,
          )
        }
        const optionPatch = record(patch, `${ruleLocation}.layerOptions.${layerId}`)
        if (Object.keys(optionPatch).length === 0) {
          fail(`${ruleLocation}.layerOptions.${layerId} must not be empty.`)
        }
      })
    }
    if (presets !== undefined) {
      const presetValues = record(presets, `${ruleLocation}.presets`)
      if (Object.keys(presetValues).length === 0) {
        fail(`${ruleLocation}.presets must not be empty.`)
      }
      Object.entries(presetValues).forEach(([target, preset]) => {
        if (target.length === 0) fail(`${ruleLocation}.presets contains an empty target.`)
        nonEmptyString(preset, `${ruleLocation}.presets.${target}`)
      })
    }
    if (textPositions !== undefined) {
      const positions = record(textPositions, `${ruleLocation}.textPositions`)
      if (Object.keys(positions).length === 0) {
        fail(`${ruleLocation}.textPositions must not be empty.`)
      }
      Object.entries(positions).forEach(([layerId, position]) => {
        if (!textLayerIds.has(layerId)) {
          fail(`${ruleLocation}.textPositions references unknown text layer "${layerId}".`)
        }
        const coordinates = record(position, `${ruleLocation}.textPositions.${layerId}`)
        finiteNumber(coordinates["x"], `${ruleLocation}.textPositions.${layerId}.x`)
        finiteNumber(coordinates["y"], `${ruleLocation}.textPositions.${layerId}.y`)
      })
    }
    if (textValues !== undefined) {
      const values = record(textValues, `${ruleLocation}.textValues`)
      if (Object.keys(values).length === 0) {
        fail(`${ruleLocation}.textValues must not be empty.`)
      }
      Object.entries(values).forEach(([layerId, source]) => {
        if (!textLayerIds.has(layerId)) {
          fail(`${ruleLocation}.textValues references unknown text layer "${layerId}".`)
        }
        nonEmptyString(source, `${ruleLocation}.textValues.${layerId}`)
      })
    }
  })
}

/**
 * Only a card-data condition needs semantic bindings to resolve against. A style gated purely on a
 * transform mode reads presentation state, so requiring bindings for it would reject a legitimate
 * template with a misleading message.
 */
function layersUseSemanticStyles(layers: readonly unknown[]): boolean {
  return layers.some((value) => {
    if (!isRecord(value)) return false
    const styles = value["semanticStyles"]
    if (Array.isArray(styles)) {
      if (styles.some((style) => isRecord(style) && style["when"] !== undefined)) return true
    } else if (styles !== undefined) return true
    return Array.isArray(value["layers"]) && layersUseSemanticStyles(value["layers"])
  })
}

function validateTemplateAuthoringRegistries(template: UnknownRecord) {
  const registryKeys = ["fitProfileSets", "fonts", "textDefaults", "typographyPresets"] as const
  const usesRegistries = registryKeys.some((key) => template[key] !== undefined)
  if (!usesRegistries) return

  if (template["fonts"] !== undefined) {
    const fonts = record(template["fonts"], "fonts")
    Object.entries(fonts).forEach(([family, assetId]) => {
      if (family.length === 0) fail("fonts must not contain an empty family name.")
      nonEmptyString(assetId, `fonts.${family}`)
    })
  }
  if (template["textDefaults"] !== undefined) {
    const defaults = record(template["textDefaults"], "textDefaults")
    assertNoUnknownKeys(
      defaults,
      new Set(["autoScaleXQuantifier", "maxAutoCompressionX"]),
      "textDefaults",
    )
    if (defaults["autoScaleXQuantifier"] !== undefined) {
      const quantifier = positiveNumber(
        defaults["autoScaleXQuantifier"],
        "textDefaults.autoScaleXQuantifier",
      )
      if (quantifier > 1) fail("textDefaults.autoScaleXQuantifier must not exceed 1.")
    }
    if (defaults["maxAutoCompressionX"] !== undefined) {
      const maximum = finiteNumber(
        defaults["maxAutoCompressionX"],
        "textDefaults.maxAutoCompressionX",
      )
      if (maximum < 0 || maximum >= 1) {
        fail("textDefaults.maxAutoCompressionX must be at least 0 and less than 1.")
      }
    }
  }
  if (template["fitProfileSets"] !== undefined) {
    const sets = record(template["fitProfileSets"], "fitProfileSets")
    Object.entries(sets).forEach(([name, profiles]) => {
      if (name.length === 0) fail("fitProfileSets must not contain an empty name.")
      validateTypography(
        {
          fill: "#000",
          fitProfiles: profiles,
          fontFamily: "validation",
          fontSize: 1,
        },
        `fitProfileSets.${name}`,
      )
    })
  }
  if (template["typographyPresets"] !== undefined) {
    const presets = record(template["typographyPresets"], "typographyPresets")
    Object.entries(presets).forEach(([name, preset]) => {
      if (name.length === 0) fail("typographyPresets must not contain an empty name.")
      const value = record(preset, `typographyPresets.${name}`)
      if (Object.keys(value).length === 0) {
        fail(`typographyPresets.${name} must declare at least one property.`)
      }
      assertNoUnknownKeys(value, textTypographyKeys, `typographyPresets.${name}`)
    })
  }
}

function hasPresentationRules(value: unknown) {
  if (Array.isArray(value)) {
    return value.some((rule) => isRecord(rule) && rule["when"] !== undefined)
  }
  return value !== undefined
}

export function validateCardTemplateShape(input: unknown): CardTemplate {
  const authoredTemplate = record(input, "Malformed card template: <root>")
  assertNoUnknownKeys(authoredTemplate, cardTemplateKeys, "Card template")
  const schemaVersion = authoredTemplate["schemaVersion"]
  if (schemaVersion === undefined) {
    fail("Malformed card template: schemaVersion is required.")
  }
  if (
    typeof schemaVersion !== "number" ||
    !Number.isInteger(schemaVersion) ||
    schemaVersion !== currentCardTemplateSchemaVersion
  ) {
    fail(
      `Unsupported card template schemaVersion ${JSON.stringify(schemaVersion)}; current version is ${currentCardTemplateSchemaVersion}. Migrate the template before using it.`,
    )
  }
  validateTemplateAuthoringRegistries(authoredTemplate)
  const template = normalizeCardTemplateAuthoring(authoredTemplate)
  const dimensions = record(template["dimensions"], "Malformed card template: dimensions")
  assertNoUnknownKeys(dimensions, new Set(["height", "width"]), "dimensions")
  positiveNumber(dimensions["width"], "dimensions.width")
  positiveNumber(dimensions["height"], "dimensions.height")

  const cardFields = template["cardFields"]
  if (!Array.isArray(cardFields)) fail("cardFields must be an array.")
  if (cardFields.length === 0) fail("cardFields must declare at least one field.")
  const fieldNames = new Set<string>()
  cardFields.forEach((field, index) => validateCardField(field, `cardFields[${index}]`, fieldNames))
  const fieldsByName = new Map(
    cardFields
      .filter((field): field is UnknownRecord => isRecord(field))
      .map((field) => [String(field["name"]), field]),
  )
  if (!fieldNames.has("name")) fail('cardFields must declare the "name" field.')
  // `CardData.name` is always represented as a string property, but an empty name is valid input.
  const nameField = cardFields.find(
    (field): field is UnknownRecord => isRecord(field) && field["name"] === "name",
  )
  const nameKind = nameField?.["kind"]
  if (nameKind !== "text" && nameKind !== "multiline") {
    fail(`cardFields "name" must use kind "text" or "multiline"; received "${String(nameKind)}".`)
  }
  const layers = template["layers"]
  if (!Array.isArray(layers)) fail("layers must be an array.")
  const canvasMasks =
    template["masks"] === undefined
      ? new Map<string, string | undefined>()
      : validateCanvasMasks(template["masks"])
  const maskIds = new Set(canvasMasks.keys())
  let semanticPaths = new Set<string>()
  if (template["semanticBindings"] !== undefined) {
    semanticPaths = new Set(
      validateSemanticBindings(template["semanticBindings"], fieldsByName).keys(),
    )
  } else if (
    layersUseSemanticStyles(layers) ||
    hasPresentationRules(template["presentationRules"])
  ) {
    fail("semanticBindings is required when the template declares semantic presentation data.")
  }
  cardFields.forEach((field, index) => {
    const fieldRecord = record(field, `cardFields[${index}]`)
    validateAutomaticWhen(
      fieldRecord["automaticWhen"],
      `cardFields[${index}].automaticWhen`,
      semanticPaths,
    )
  })
  const ids = new Set<string>()
  const textLayerIds = new Set<string>()
  const assetLayerIds = new Set<string>()
  const optionsLayerIds = new Set<string>()
  const nonMaskableLayerIds = new Set<string>()
  const regionLayerIds = new Set<string>()
  // Collected before validation so a style or rule may gate on a transform declared by a later
  // layer; malformed layers are skipped here and rejected by ordinary layer validation below.
  const transformIds = collectArtworkTransformIds(layers)
  layers.forEach((layer, index) =>
    validateLayer(
      layer,
      `layers[${index}]`,
      ids,
      fieldsByName,
      textLayerIds,
      assetLayerIds,
      optionsLayerIds,
      nonMaskableLayerIds,
      regionLayerIds,
      semanticPaths,
      transformIds,
    ),
  )
  canvasMasks.forEach((coverageLayerId, maskId) => {
    if (coverageLayerId !== undefined && !ids.has(coverageLayerId)) {
      fail(`Canvas mask "${maskId}" references unknown coverage layer "${coverageLayerId}".`)
    }
    if (coverageLayerId !== undefined && nonMaskableLayerIds.has(coverageLayerId)) {
      fail(
        `Canvas mask "${maskId}" coverage layer "${coverageLayerId}" is not a raster-output layer.`,
      )
    }
  })
  validateAutomaticFitLayers(cardFields, layers)
  if (template["presentationRules"] !== undefined) {
    validateSemanticPresentationRules(
      template["presentationRules"],
      ids,
      textLayerIds,
      assetLayerIds,
      optionsLayerIds,
      nonMaskableLayerIds,
      regionLayerIds,
      maskIds,
      semanticPaths,
      transformIds,
    )
    // Rule shapes, layer IDs, and mask IDs are valid by this point; only the cross-cutting
    // coverage/target ordering remains, and it needs the complete layer order.
    const layerOrder = layerRenderOrder(ids)
    ;(template["presentationRules"] as readonly UnknownRecord[]).forEach((rule, index) => {
      const selections = rule["maskSelections"]
      if (selections === undefined) return
      Object.entries(selections as UnknownRecord).forEach(([layerId, maskId]) => {
        assertCoverageRendersFirst(
          maskId as string,
          layerId,
          `presentationRules[${index}].maskSelections`,
          canvasMasks,
          layerOrder,
        )
      })
    })
  }
  return template as unknown as CardTemplate
}

function templateTextLayers(template: CardTemplate) {
  const layers = new Map<string, TextLayer>()
  const visit = (entries: readonly LayerDefinition[]) => {
    entries.forEach((layer) => {
      if (layer.kind === "text") layers.set(layer.id, layer as TextLayer)
      if (layer.kind === "group") visit((layer as { layers: readonly LayerDefinition[] }).layers)
    })
  }
  visit(template.layers)
  return layers
}

function templateLayerMaskTargets(template: CardTemplate) {
  const layerIds = new Set<string>()
  const nonMaskableLayerIds = new Set<string>()
  const visit = (entries: readonly LayerDefinition[]) => {
    entries.forEach((layer) => {
      layerIds.add(layer.id)
      if (layer.kind === "text" || layer.kind === "svg") {
        nonMaskableLayerIds.add(layer.id)
      }
      if (layer.kind === "group") {
        visit((layer as { layers: readonly LayerDefinition[] }).layers)
      }
    })
  }
  visit(template.layers)
  return { layerIds, layerOrder: layerRenderOrder(layerIds), nonMaskableLayerIds }
}

function typographyForStyle(layer: TextLayer, styleId: string, location: string) {
  if (styleId === "default") return layer.typography
  const style = layer.semanticStyles?.find((candidate) => candidate.id === styleId)
  if (!style) fail(`${location} references unknown semantic style "${styleId}".`)
  return mergeTextTypography(layer.typography, style.typography)
}

/** Validates untrusted or persisted user presentation overrides against one validated template. */
export function validatePresentationOverridesShape(
  input: unknown,
  template: CardTemplate,
): PresentationOverrides {
  const overrides = record(input, "Presentation overrides")
  assertNoUnknownKeys(
    overrides,
    new Set(["artworkTransforms", "layerMasks", "textFitProfiles", "textTypography"]),
    "Presentation overrides",
  )
  const textLayers = templateTextLayers(template)
  const { layerIds, layerOrder, nonMaskableLayerIds } = templateLayerMaskTargets(template)
  const maskIds = new Set(template.masks?.map((mask) => mask.id) ?? [])
  const coverageLayerIds = new Map(
    template.masks?.map((mask) => [mask.id, mask.coverageLayerId] as const) ?? [],
  )

  if (overrides["artworkTransforms"] !== undefined) {
    const transforms = record(overrides["artworkTransforms"], "artworkTransforms")
    const transformIds = new Set<string>()
    walkLayers(template.layers, ({ layer }) => {
      if (layer.kind === "artwork") {
        const artwork = layer as ArtworkLayer
        transformIds.add(artwork.transformId ?? artwork.id)
      }
    })
    Object.entries(transforms).forEach(([id, value]) => {
      if (!transformIds.has(id)) fail(`artworkTransforms references unknown transform "${id}".`)
      const transform = record(value, `artworkTransforms.${id}`)
      assertNoUnknownKeys(
        transform,
        new Set(["mode", "scale", "x", "y"]),
        `artworkTransforms.${id}`,
      )
      const scale = finiteNumber(transform["scale"], `artworkTransforms.${id}.scale`)
      const x = finiteNumber(transform["x"], `artworkTransforms.${id}.x`)
      const y = finiteNumber(transform["y"], `artworkTransforms.${id}.y`)
      if (transform["mode"] !== undefined) {
        nonEmptyString(transform["mode"], `artworkTransforms.${id}.mode`)
      }
      if (scale < 1 || scale > 8) fail(`artworkTransforms.${id}.scale must be between 1 and 8.`)
      if (x < -2 || x > 2 || y < -2 || y > 2) {
        fail(`artworkTransforms.${id} pan values must be between -2 and 2.`)
      }
    })
  }

  if (overrides["textTypography"] !== undefined) {
    const layerPatches = record(overrides["textTypography"], "textTypography")
    Object.entries(layerPatches).forEach(([layerId, value]) => {
      const layer = textLayers.get(layerId)
      if (!layer) fail(`textTypography references unknown text layer "${layerId}".`)
      const styles = record(value, `textTypography.${layerId}`)
      Object.entries(styles).forEach(([styleId, patch]) => {
        const location = `textTypography.${layerId}.${styleId}`
        validateTypographyPatch(
          patch,
          typographyForStyle(layer, styleId, location),
          layer.format,
          location,
        )
      })
    })
  }

  if (overrides["textFitProfiles"] !== undefined) {
    const layerProfiles = record(overrides["textFitProfiles"], "textFitProfiles")
    Object.entries(layerProfiles).forEach(([layerId, value]) => {
      const layer = textLayers.get(layerId)
      if (!layer) fail(`textFitProfiles references unknown text layer "${layerId}".`)
      const styles = record(value, `textFitProfiles.${layerId}`)
      Object.entries(styles).forEach(([styleId, profileId]) => {
        if (profileId === undefined) return
        const location = `textFitProfiles.${layerId}.${styleId}`
        const parsedProfileId = nonEmptyString(profileId, location)
        const typography = typographyForStyle(layer, styleId, location)
        if (!typography.fitProfiles?.some((profile) => profile.id === parsedProfileId)) {
          fail(`${location} references unknown fit profile "${parsedProfileId}".`)
        }
      })
    })
  }

  if (overrides["layerMasks"] !== undefined) {
    const masks = record(overrides["layerMasks"], "layerMasks")
    Object.entries(masks).forEach(([layerId, maskId]) => {
      if (!layerIds.has(layerId)) {
        fail(`layerMasks references unknown layer "${layerId}".`)
      }
      if (nonMaskableLayerIds.has(layerId)) {
        fail(`layerMasks cannot assign a mask to non-raster layer "${layerId}".`)
      }
      if (maskId !== null && maskId !== undefined && (typeof maskId !== "string" || !maskId)) {
        fail(`layerMasks.${layerId} must be a non-empty string or null.`)
      }
      if (typeof maskId === "string" && !maskIds.has(maskId)) {
        fail(`layerMasks.${layerId} references unknown mask "${maskId}".`)
      }
      if (typeof maskId === "string") {
        assertCoverageRendersFirst(maskId, layerId, "layerMasks", coverageLayerIds, layerOrder)
      }
    })
  }

  return overrides
}

export function validateTemplateManifestShape(input: unknown): TemplateManifest {
  const manifest = record(input, "Malformed template manifest: <root>")
  assertNoUnknownKeys(manifest, manifestKeys, "Template manifest")
  nonEmptyString(manifest["id"], "id")
  const kind = manifest["kind"]
  if (typeof kind !== "string" || !templateKinds.has(kind)) {
    fail(`kind "${String(kind)}" is unsupported.`)
  }
  nonEmptyString(manifest["name"], "name")
  const version = manifest["version"]
  if (!isTemplateVersion(version)) fail("version must use YYYY.MM.DD or YYYY.MM.DD.N.")
  const status = manifest["status"]
  if (status !== undefined && (typeof status !== "string" || !templateStatuses.has(status))) {
    fail(`status ${JSON.stringify(status)} is unsupported.`)
  }
  relativePath(manifest["template"], "Manifest template path")
  const assets = record(manifest["assets"], "Malformed template manifest: assets")
  Object.entries(assets).forEach(([id, assetPath]) => {
    nonEmptyString(id, "Asset ID")
    relativePath(assetPath, `Asset "${id}" path`)
  })
  if (manifest["colorPresets"] !== undefined) {
    relativePath(manifest["colorPresets"], "Manifest color-preset path")
  }
  if (manifest["templateDependencies"] !== undefined) {
    stringArray(manifest["templateDependencies"], "templateDependencies", true)
  }
  return manifest as unknown as TemplateManifest
}

export type { CardFieldKind, LayerDefinition, TemplateKind, TemplateStatus, TextFormat }
const templateVersionPattern = /^\d{4}\.\d{2}\.\d{2}(?:\.[1-9]\d*)?$/

function isTemplateVersion(value: unknown): value is string {
  if (typeof value !== "string" || !templateVersionPattern.test(value)) return false
  const [year, month, day] = value.split(".").map(Number)
  if (!year || !month || !day) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}
