import { graphemeSegments } from "../rich-text.js"
import { validateSvgElementDefinition } from "../validation.js"

import { isDrawable, throwIfAborted } from "./assets.js"

import type {
  AssetResolver,
  AssetSource,
  ResolvedCardPresentation,
  SvgElementDefinition,
} from "../contracts/index.js"
import type { Font, FontCollection, Glyph } from "fontkit"

const SVG_NAMESPACE = "http://www.w3.org/2000/svg"
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace"
const MAX_URL_FONT_CACHE_ENTRIES = 32
const OUTLINED_GROUP_ATTRIBUTES = new Set(["id", "role", "transform"])

const blobFontCache = new WeakMap<Blob, Promise<Font>>()
const urlFontCache = new Map<string, Promise<Font>>()

interface DomElementPair {
  natural: SVGElement
  rendered: SVGElement
}

interface TextRun {
  naturalElement: SVGTextContentElement
  renderedElement: SVGTextContentElement
  start: number
  text: string
}

interface OutlinedTextStyle {
  dominantBaseline: string
  fill: string
  fillOpacity: string
  font: Font
  fontFamily: string
  fontSize: number
  opacity: string
  stroke: string
  strokeLinecap: string
  strokeLinejoin: string
  strokeMiterlimit: string
  strokeOpacity: string
  strokeWidth: string
  syntheticBold: boolean
  syntheticItalic: boolean
}

interface BrowserFontkitModule {
  create(buffer: Uint8Array): Font | FontCollection
}

function abortError() {
  return new DOMException("Rendering was aborted.", "AbortError")
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : abortError()
}

async function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal)
  if (!signal) return await promise
  return await new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortReason(signal))
    signal.addEventListener("abort", abort, { once: true })
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

function boundedGet<T>(cache: Map<string, T>, key: string) {
  const value = cache.get(key)
  if (value !== undefined) {
    cache.delete(key)
    cache.set(key, value)
  }
  return value
}

function boundedSet<T>(cache: Map<string, T>, key: string, value: T, maximum: number) {
  cache.set(key, value)
  if (cache.size > maximum) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

function sourceCacheKey(source: string | URL) {
  const value = source instanceof URL ? source.href : source
  try {
    return new URL(value, document.baseURI).href
  } catch {
    return value
  }
}

async function readFontSource(source: string | URL | Blob) {
  if (source instanceof Blob) return new Uint8Array(await source.arrayBuffer())
  const url = source instanceof URL ? source.href : source
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Could not load font outlines from "${url}" (${response.status}).`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

function asBrowserFontkitModule(value: unknown): BrowserFontkitModule {
  if (
    typeof value !== "object" ||
    value === null ||
    !("create" in value) ||
    typeof value.create !== "function"
  ) {
    throw new Error("The Fontkit runtime does not expose a create function.")
  }
  return value as BrowserFontkitModule
}

async function parseFont(source: string | URL | Blob) {
  const bytes = await readFontSource(source)
  const fontkit = asBrowserFontkitModule(
    import.meta.env.DEV
      ? await import("fontkit")
      : await import(
          /* @vite-ignore */ new URL(/* @vite-ignore */ "./fontkit-runtime.js", import.meta.url)
            .href
        ),
  )
  // Fontkit's browser build accepts Uint8Array. Its DefinitelyTyped declaration retains the
  // Node-only Buffer signature even though this code is bundled against the browser export.
  const parsed = fontkit.create(bytes)
  if ("fonts" in parsed) {
    throw new Error("Font collections are not supported for SVG text outlining.")
  }
  return parsed
}

async function loadOutlineFont(
  source: AssetSource,
  assetId: string,
  signal?: AbortSignal,
): Promise<Font> {
  if (isDrawable(source)) {
    throw new Error(`Font asset "${assetId}" must resolve to a URL string, URL, or Blob.`)
  }
  const blob = source instanceof Blob ? source : undefined
  const key = source instanceof Blob ? undefined : sourceCacheKey(source)
  let promise = blob ? blobFontCache.get(blob) : key ? boundedGet(urlFontCache, key) : undefined
  if (!promise) {
    promise = parseFont(source)
    if (blob) blobFontCache.set(blob, promise)
    if (key) boundedSet(urlFontCache, key, promise, MAX_URL_FONT_CACHE_ENTRIES)
    void promise.catch(() => {
      if (blob && blobFontCache.get(blob) === promise) blobFontCache.delete(blob)
      if (key && urlFontCache.get(key) === promise) urlFontCache.delete(key)
    })
  }
  return await withAbort(promise, signal)
}

function createMeasurementSvg(width: number, height: number) {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg")
  svg.setAttribute("width", String(width))
  svg.setAttribute("height", String(height))
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`)
  svg.style.overflow = "visible"
  return svg
}

function appendDefinition(
  definition: SvgElementDefinition,
  renderedParent: SVGElement,
  naturalParent: SVGElement,
  pairs: Map<SvgElementDefinition, DomElementPair>,
) {
  const rendered = document.createElementNS(SVG_NAMESPACE, definition.tag)
  const natural = document.createElementNS(SVG_NAMESPACE, definition.tag)
  Object.entries(definition.attributes ?? {}).forEach(([name, value]) => {
    const serialized = String(value)
    if (name === "xml:space") {
      rendered.setAttributeNS(XML_NAMESPACE, name, serialized)
      natural.setAttributeNS(XML_NAMESPACE, name, serialized)
      return
    }
    rendered.setAttribute(name, serialized)
    if (name !== "textLength" && name !== "lengthAdjust") {
      natural.setAttribute(name, serialized)
    }
  })
  if (definition.text !== undefined) {
    rendered.append(document.createTextNode(definition.text))
    natural.append(document.createTextNode(definition.text))
  }
  renderedParent.append(rendered)
  naturalParent.append(natural)
  pairs.set(definition, { natural, rendered })
  definition.children?.forEach((child) => appendDefinition(child, rendered, natural, pairs))
}

function textRuns(
  definition: SvgElementDefinition,
  pairs: ReadonlyMap<SvgElementDefinition, DomElementPair>,
) {
  const runs: TextRun[] = []
  const cursor = { value: 0 }
  const visit = (entry: SvgElementDefinition) => {
    const pair = pairs.get(entry)
    if (!pair) throw new Error("Could not measure rendered SVG text.")
    if (entry.text !== undefined && entry.text.length > 0) {
      runs.push({
        naturalElement: pair.natural as SVGTextContentElement,
        renderedElement: pair.rendered as SVGTextContentElement,
        start: cursor.value,
        text: entry.text,
      })
      cursor.value += entry.text.length
    }
    entry.children?.forEach(visit)
  }
  visit(definition)
  return runs
}

export function declaredTextLengthScale(
  lengthAdjust: string | null,
  textLength: string | null,
  naturalLength: number,
) {
  if (lengthAdjust !== "spacingAndGlyphs") return undefined
  const targetLength = Number.parseFloat(textLength ?? "")
  if (!Number.isFinite(targetLength) || !(targetLength > 0) || !(naturalLength > 0)) {
    return undefined
  }
  return targetLength / naturalLength
}

function textLengthScale(
  renderedElement: SVGTextContentElement,
  naturalElement: SVGTextContentElement,
) {
  return declaredTextLengthScale(
    renderedElement.getAttribute("lengthAdjust"),
    renderedElement.getAttribute("textLength"),
    naturalElement.getSubStringLength(0, naturalElement.getNumberOfChars()),
  )
}

function fontAssetIds(presentation: ResolvedCardPresentation) {
  const fonts = new Map<string, string>()
  Object.values(presentation.text).forEach(({ typography }) => {
    if (!typography.fontAssetId) return
    const existing = fonts.get(typography.fontFamily)
    if (existing && existing !== typography.fontAssetId) {
      throw new Error(
        `Font family "${typography.fontFamily}" maps to both "${existing}" and "${typography.fontAssetId}".`,
      )
    }
    fonts.set(typography.fontFamily, typography.fontAssetId)
  })
  return fonts
}

function cssFontFamilies(value: string) {
  const families: string[] = []
  let current = ""
  let quote = ""
  for (const character of value) {
    if (quote) {
      if (character === quote) quote = ""
      else current += character
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === ",") {
      if (current.trim()) families.push(current.trim())
      current = ""
    } else {
      current += character
    }
  }
  if (current.trim()) families.push(current.trim())
  return families
}

function resolvedFontFamily(style: CSSStyleDeclaration, assetIds: ReadonlyMap<string, string>) {
  const family = cssFontFamilies(style.fontFamily).find((candidate) => assetIds.has(candidate))
  if (!family) {
    throw new Error(
      `Cannot outline SVG text using font-family "${style.fontFamily}" because it has no resolved fontAssetId. Use textMode "text" or declare the font asset in template typography.`,
    )
  }
  return family
}

function ignoredCodePoint(codePoint: number) {
  return (
    codePoint === 0x200c ||
    codePoint === 0x200d ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  )
}

function assertGlyphCoverage(font: Font, fontFamily: string, grapheme: string) {
  for (const character of grapheme) {
    const codePoint = character.codePointAt(0)
    if (
      codePoint !== undefined &&
      !ignoredCodePoint(codePoint) &&
      !font.hasGlyphForCodePoint(codePoint)
    ) {
      throw new Error(
        `Font "${fontFamily}" has no glyph for ${JSON.stringify(character)} (U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}); SVG path export cannot use a system-font fallback.`,
      )
    }
  }
}

function number(value: number) {
  const rounded = Math.abs(value) < 0.0000005 ? 0 : Number(value.toFixed(6))
  return String(rounded)
}

/** Firefox exposes SVG's `text-before-edge` as the equivalent CSS `text-top` value. */
export function isTopDominantBaseline(value: string) {
  return value === "text-before-edge" || value === "text-top"
}

function glyphFill(glyph: Glyph, fallback: string) {
  return (
    glyph.layers?.map(({ color, glyph: layerGlyph }) => ({
      fill: `rgb(${color.red} ${color.green} ${color.blue} / ${color.alpha})`,
      glyph: layerGlyph,
    })) ?? [{ fill: fallback, glyph }]
  )
}

function paintAttributes(style: OutlinedTextStyle, fill: string) {
  const strokeWidth = Number.parseFloat(style.strokeWidth)
  const strokeWidthInFontUnits =
    Number.isFinite(strokeWidth) && strokeWidth > 0
      ? (strokeWidth / style.fontSize) * style.font.unitsPerEm
      : style.strokeWidth
  const stroke =
    style.stroke === "none" && style.syntheticBold
      ? {
          stroke: fill,
          "stroke-linejoin": "round",
          ...(style.fillOpacity === "1" ? {} : { "stroke-opacity": style.fillOpacity }),
          "stroke-width": style.font.unitsPerEm / 24,
        }
      : style.stroke === "none"
        ? undefined
        : {
            stroke: style.stroke,
            ...(style.strokeLinecap === "butt" ? {} : { "stroke-linecap": style.strokeLinecap }),
            ...(style.strokeLinejoin === "miter"
              ? {}
              : { "stroke-linejoin": style.strokeLinejoin }),
            ...(style.strokeMiterlimit === "4"
              ? {}
              : { "stroke-miterlimit": style.strokeMiterlimit }),
            ...(style.strokeOpacity === "1" ? {} : { "stroke-opacity": style.strokeOpacity }),
            "stroke-width": strokeWidthInFontUnits,
          }
  return {
    fill,
    ...(style.fillOpacity === "1" ? {} : { "fill-opacity": style.fillOpacity }),
    ...(style.opacity === "1" ? {} : { opacity: style.opacity }),
    ...stroke,
  } satisfies Readonly<Record<string, string | number>>
}

async function outlinedStyle(
  element: SVGTextContentElement,
  assetIds: ReadonlyMap<string, string>,
  assets: AssetResolver,
  fonts: Map<string, Promise<Font>>,
  signal?: AbortSignal,
): Promise<OutlinedTextStyle> {
  const computed = getComputedStyle(element)
  const fontFamily = resolvedFontFamily(computed, assetIds)
  const assetId = assetIds.get(fontFamily)
  if (!assetId) throw new Error(`Font family "${fontFamily}" has no resolved font asset.`)
  let font = fonts.get(fontFamily)
  if (!font) {
    font = loadOutlineFont(assets.resolve(assetId), assetId, signal)
    fonts.set(fontFamily, font)
  }
  const fontSize = Number.parseFloat(computed.fontSize)
  if (!Number.isFinite(fontSize) || fontSize <= 0) {
    throw new Error(`Cannot outline SVG text with font-size "${computed.fontSize}".`)
  }
  const resolvedFont = await font
  const requestedWeight = Number.parseInt(computed.fontWeight, 10)
  const isRequestedBold = Number.isFinite(requestedWeight) && requestedWeight >= 600
  const isFontBold =
    resolvedFont["OS/2"].fsSelection.bold ||
    /(?:^|[\s-])bold(?:$|[\s-])/iu.test(resolvedFont.subfamilyName)
  const isRequestedItalic = computed.fontStyle !== "normal"
  const isFontItalic =
    resolvedFont.italicAngle !== 0 ||
    resolvedFont["OS/2"].fsSelection.italic ||
    /(?:italic|oblique)/iu.test(resolvedFont.subfamilyName)
  return {
    dominantBaseline: computed.dominantBaseline,
    fill: computed.fill,
    fillOpacity: computed.fillOpacity,
    font: resolvedFont,
    fontFamily,
    fontSize,
    opacity: computed.opacity,
    stroke: computed.stroke,
    strokeLinecap: computed.strokeLinecap,
    strokeLinejoin: computed.strokeLinejoin,
    strokeMiterlimit: computed.strokeMiterlimit,
    strokeOpacity: computed.strokeOpacity,
    strokeWidth: computed.strokeWidth,
    syntheticBold: isRequestedBold && !isFontBold,
    syntheticItalic: isRequestedItalic && !isFontItalic,
  }
}

async function outlineText(
  definition: SvgElementDefinition,
  pairs: ReadonlyMap<SvgElementDefinition, DomElementPair>,
  assetIds: ReadonlyMap<string, string>,
  assets: AssetResolver,
  fonts: Map<string, Promise<Font>>,
  signal?: AbortSignal,
): Promise<SvgElementDefinition> {
  const pair = pairs.get(definition)
  if (!pair) throw new Error("Could not measure rendered SVG text.")
  const renderedRoot = pair.rendered as SVGTextContentElement
  const naturalRoot = pair.natural as SVGTextContentElement
  const runs = textRuns(definition, pairs)
  const expectedCharacters = runs.reduce((count, run) => count + run.text.length, 0)
  if (
    renderedRoot.getNumberOfChars() < expectedCharacters ||
    naturalRoot.getNumberOfChars() < expectedCharacters
  ) {
    throw new Error("The browser could not measure every character required for SVG path export.")
  }

  const paths: SvgElementDefinition[] = []
  for (const run of runs) {
    throwIfAborted(signal)
    const style = await outlinedStyle(run.renderedElement, assetIds, assets, fonts, signal)
    const declaredStretch = textLengthScale(run.renderedElement, run.naturalElement)
    const naturalRunLength = run.naturalElement.getSubStringLength(0, run.text.length)
    const renderedRunLength = run.renderedElement.getSubStringLength(0, run.text.length)
    const browserStretch = naturalRunLength > 0 ? renderedRunLength / naturalRunLength : 1
    // Firefox currently reports natural widths for textLength runs. Keep the browser's exact
    // character positions where its metrics honor textLength, and reconstruct only the affected
    // run locally when the measured and declared scales disagree.
    const useManualTextLength =
      declaredStretch !== undefined && Math.abs(browserStretch - declaredStretch) > 0.000001
    const renderedOrigin = useManualTextLength
      ? run.renderedElement.getStartPositionOfChar(0)
      : undefined
    const naturalOrigin = useManualTextLength
      ? run.naturalElement.getStartPositionOfChar(0)
      : undefined
    let index = 0
    for (const grapheme of graphemeSegments(run.text)) {
      throwIfAborted(signal)
      assertGlyphCoverage(style.font, style.fontFamily, grapheme)
      const globalIndex = run.start + index
      const stretch = useManualTextLength ? declaredStretch : undefined
      const start = useManualTextLength
        ? (() => {
            const naturalStart = run.naturalElement.getStartPositionOfChar(index)
            return {
              x: renderedOrigin!.x + (naturalStart.x - naturalOrigin!.x) * stretch!,
              y: renderedOrigin!.y + (naturalStart.y - naturalOrigin!.y),
            }
          })()
        : renderedRoot.getStartPositionOfChar(globalIndex)
      const rotation = useManualTextLength
        ? run.renderedElement.getRotationOfChar(index)
        : renderedRoot.getRotationOfChar(globalIndex)
      const scaleY = style.fontSize / style.font.unitsPerEm
      const renderedLength = useManualTextLength
        ? run.naturalElement.getSubStringLength(index, grapheme.length) * stretch!
        : renderedRoot.getSubStringLength(globalIndex, grapheme.length)
      const naturalLength = run.naturalElement.getSubStringLength(index, grapheme.length)
      const measuredStretch = naturalLength > 0 ? renderedLength / naturalLength : 1
      const scaleX =
        scaleY * (Number.isFinite(measuredStretch) && measuredStretch > 0 ? measuredStretch : 1)
      const baselineOffset = isTopDominantBaseline(style.dominantBaseline)
        ? style.font.ascent * scaleY
        : 0
      const layout = style.font.layout(grapheme)
      let penX = 0
      let penY = 0
      layout.glyphs.forEach((glyph, glyphIndex) => {
        const position = layout.positions[glyphIndex]
        if (!position) return
        const x = start.x + (penX + position.xOffset) * scaleX
        const y = start.y + baselineOffset - (penY + position.yOffset) * scaleY
        const transform = [
          `translate(${number(x)} ${number(y)})`,
          ...(rotation === 0 ? [] : [`rotate(${number(rotation)})`]),
          `scale(${number(scaleX)} ${number(-scaleY)})`,
          ...(style.syntheticItalic ? ["skewX(11.309932)"] : []),
        ].join(" ")
        glyphFill(glyph, style.fill).forEach(({ fill, glyph: paintedGlyph }) => {
          const d = paintedGlyph.path.toSVG()
          if (!d) return
          paths.push({
            attributes: { d, ...paintAttributes(style, fill), transform },
            tag: "path",
          })
        })
        penX += position.xAdvance
        penY += position.yAdvance
      })
      index += grapheme.length
    }
  }
  const groupAttributes = Object.fromEntries(
    Object.entries(definition.attributes ?? {}).filter(([name]) =>
      OUTLINED_GROUP_ATTRIBUTES.has(name),
    ),
  )
  return {
    ...(Object.keys(groupAttributes).length > 0 ? { attributes: groupAttributes } : {}),
    children: paths,
    tag: "g",
  }
}

async function outlineDefinition(
  definition: SvgElementDefinition,
  pairs: ReadonlyMap<SvgElementDefinition, DomElementPair>,
  assetIds: ReadonlyMap<string, string>,
  assets: AssetResolver,
  fonts: Map<string, Promise<Font>>,
  signal?: AbortSignal,
): Promise<SvgElementDefinition> {
  if (definition.tag === "text") {
    return await outlineText(definition, pairs, assetIds, assets, fonts, signal)
  }
  const children = definition.children
    ? await Promise.all(
        definition.children.map((child) =>
          outlineDefinition(child, pairs, assetIds, assets, fonts, signal),
        ),
      )
    : undefined
  return {
    ...(definition.attributes ? { attributes: definition.attributes } : {}),
    ...(children ? { children } : {}),
    tag: definition.tag,
    ...(definition.text === undefined ? {} : { text: definition.text }),
  }
}

/** Replaces validated SVG text with glyph paths after the browser has performed final layout. */
export async function outlineSvgText(
  elements: readonly SvgElementDefinition[],
  dimensions: Readonly<{ height: number; width: number }>,
  presentation: ResolvedCardPresentation,
  assets: AssetResolver,
  signal?: AbortSignal,
) {
  const containsText = (element: SvgElementDefinition): boolean =>
    element.tag === "text" || Boolean(element.children?.some(containsText))
  if (!elements.some(containsText)) {
    return elements
  }
  const host = document.createElement("div")
  host.style.position = "fixed"
  host.style.left = "-100000px"
  host.style.top = "0"
  host.style.width = `${dimensions.width}px`
  host.style.height = `${dimensions.height}px`
  host.style.opacity = "0"
  host.style.pointerEvents = "none"
  const renderedSvg = createMeasurementSvg(dimensions.width, dimensions.height)
  const naturalSvg = createMeasurementSvg(dimensions.width, dimensions.height)
  host.append(renderedSvg, naturalSvg)
  const pairs = new Map<SvgElementDefinition, DomElementPair>()
  elements.forEach((element) => appendDefinition(element, renderedSvg, naturalSvg, pairs))
  ;(document.body ?? document.documentElement).append(host)
  try {
    const ids = fontAssetIds(presentation)
    const fonts = new Map<string, Promise<Font>>()
    const outlined = await Promise.all(
      elements.map((element) => outlineDefinition(element, pairs, ids, assets, fonts, signal)),
    )
    outlined.forEach((element, index) =>
      validateSvgElementDefinition(element, `Outlined SVG element ${index}`),
    )
    return Object.freeze(outlined)
  } finally {
    host.remove()
  }
}
