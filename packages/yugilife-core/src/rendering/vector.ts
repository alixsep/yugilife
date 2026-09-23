import {
  graphemeSegments,
  hasLeadingAuthoredLineFitSplit,
  parseRichText,
  parseRichTextLength,
  plainTextFromRichText,
  richTextHasFormatting,
} from "../rich-text.js"

import type {
  CardData,
  SemanticValue,
  SvgElementDefinition,
  TextFitProfile,
  TextLayer,
  TextStroke,
  TextTypography,
} from "../contracts/index.js"
import type {
  RichTextDocument,
  RichTextElementNode,
  RichTextLength,
  RichTextNode,
  RichTextWarning,
} from "../rich-text.js"

/**
 * The single place a `TextStroke` becomes SVG paint. SVG has no outer-stroke primitive: a stroke
 * straddles the outline, so half of it would eat into the glyph and letters would read thinner than
 * authored. Outer alignment is therefore expressed as a double-width stroke painted *before* the
 * fill, which then covers the inner half and leaves exactly the authored visible width outside.
 *
 * Both serializations consume these attributes — `<text>` mode directly, and outlined-path export
 * through the browser's computed style — so the doubling and paint order cannot drift apart.
 *
 * Width follows the fitted font scale so an automatically shrunk line keeps its authored proportion.
 * It never feeds back into measurement: stroke is painted, never measured.
 */
function strokeAttributes(stroke: TextStroke | undefined, fontScale: number) {
  if (!stroke) return {}
  const outer = (stroke.align ?? "outer") === "outer"
  return {
    "paint-order": outer ? "stroke fill" : "fill stroke",
    stroke: stroke.color,
    "stroke-linejoin": stroke.linejoin ?? "round",
    ...(stroke.opacity !== undefined ? { "stroke-opacity": stroke.opacity } : {}),
    "stroke-width": stableLayoutNumber(stroke.width * (outer ? 2 : 1) * fontScale),
  } satisfies Readonly<Record<string, string | number>>
}

export type TextMeasurer = (text: string, typography: TextTypography) => number

export interface TextLayoutOptions {
  fitProfileId?: string | undefined
  onWarning?: ((warning: RichTextWarning) => void) | undefined
  semanticValue?: SemanticValue | undefined
  typography?: TextTypography | undefined
}

interface TextLayoutLine {
  autoScaleX: number
  paragraphEnd: boolean
  text: string
}

interface TextProfileLayout<Line> {
  lines: readonly Line[]
  profile?: TextFitProfile | undefined
  typography: TextTypography
}

const defaultAutoScaleXQuantifier = 0.01
const scaleEpsilon = 1e-9

function stableLayoutNumber(value: number) {
  return Number(value.toFixed(12))
}

function minimumAutoScaleX(profile: TextFitProfile, typography: TextTypography) {
  return 1 - (profile.maxAutoCompressionX ?? typography.maxAutoCompressionX ?? 0)
}

function autoScaleXQuantifier(typography: TextTypography) {
  return typography.autoScaleXQuantifier ?? defaultAutoScaleXQuantifier
}

function floorAutoScaleX(scale: number, typography: TextTypography) {
  const quantifier = autoScaleXQuantifier(typography)
  return stableLayoutNumber(Math.floor((scale + scaleEpsilon) / quantifier) * quantifier)
}

function smallestQuantifiedAutoScaleX(profile: TextFitProfile, typography: TextTypography) {
  const quantifier = autoScaleXQuantifier(typography)
  const minimum = minimumAutoScaleX(profile, typography)
  return stableLayoutNumber(
    Math.min(1, Math.ceil((minimum - scaleEpsilon) / quantifier) * quantifier),
  )
}

/** Finds the largest permitted scale and floors the result to the declared quantifier. */
function largestFittingAutoScaleX(
  profile: TextFitProfile,
  typography: TextTypography,
  fits: (scale: number) => boolean,
) {
  if (fits(1)) return 1
  const minimum = minimumAutoScaleX(profile, typography)
  if (!fits(minimum)) return undefined

  let fitting = minimum
  let overflowing = 1
  for (let index = 0; index < 24; index += 1) {
    const candidate = (fitting + overflowing) / 2
    if (fits(candidate)) fitting = candidate
    else overflowing = candidate
  }

  const quantified = floorAutoScaleX(fitting, typography)
  if (quantified + scaleEpsilon < minimum) return undefined
  return fits(quantified) ? quantified : undefined
}

function typographyForFitProfile(base: TextTypography, profile: TextFitProfile): TextTypography {
  return {
    ...base,
    fontSize: profile.fontSize,
    lineHeight: profile.lineHeight ?? profile.fontSize,
  }
}

function linesFitProfile(lineCount: number, profile: TextFitProfile, typography: TextTypography) {
  if (profile.maxLines !== undefined && lineCount > profile.maxLines) return false
  if (typography.maxHeight !== undefined) {
    const lineHeight = typography.lineHeight ?? typography.fontSize
    const height = typography.fontSize + Math.max(0, lineCount - 1) * lineHeight
    if (height > typography.maxHeight) return false
  }
  return true
}

function wrapLine(
  line: string,
  maxWidth: number,
  typography: TextTypography,
  measureText: TextMeasurer,
) {
  if (line === "" || measureText(line, typography) <= maxWidth) return [line]

  // Keep whitespace attached to the preceding word. This preserves authored spaces on either side
  // of a soft wrap, including two or more consecutive spaces.
  const tokens = line.match(/\S+(?:[^\S\r\n]+|$)|[^\S\r\n]+/gu) ?? [line]
  const wrapped: string[] = []
  let current = ""

  const appendPiece = (piece: string) => {
    if (current && measureText(`${current}${piece}`, typography) > maxWidth) {
      wrapped.push(current)
      current = ""
    }
    if (measureText(piece, typography) <= maxWidth) {
      current = piece
      return
    }
    for (const character of graphemeSegments(piece)) {
      if (current && measureText(`${current}${character}`, typography) > maxWidth) {
        wrapped.push(current)
        current = character
      } else {
        current += character
      }
    }
  }

  for (const token of tokens) {
    if (!current) {
      appendPiece(token)
    } else if (measureText(`${current}${token}`, typography) <= maxWidth) {
      current += token
    } else {
      wrapped.push(current)
      current = ""
      appendPiece(token)
    }
  }
  if (current || wrapped.length === 0) wrapped.push(current)
  return wrapped
}

function textValue(card: CardData, layer: TextLayer, semanticValue?: SemanticValue) {
  const value = layer.semanticPath
    ? semanticValue
    : layer.field
      ? (card[layer.field] ?? (layer.fallbackField ? card[layer.fallbackField] : undefined))
      : undefined
  if (value === undefined) return ""
  if (value === "") return ""
  const prefix = layer.prefix ?? ""
  const suffix = layer.suffix ?? ""
  if (Array.isArray(value)) {
    const values = value.map((item) =>
      item === undefined ? undefined : typeof item === "string" ? item : String(item),
    )
    if (layer.format === "pair") {
      const entries =
        layer.pairIndex === undefined
          ? values.filter((item): item is string => item !== undefined && item.length > 0)
          : values[layer.pairIndex]
            ? [values[layer.pairIndex] as string]
            : []
      return entries.length > 0 ? `${prefix}${entries.join(layer.separator ?? " / ")}${suffix}` : ""
    }
    const presentValues = values.filter((item): item is string => item !== undefined)
    if (layer.format === "type-list") {
      const entries = presentValues.filter((item) => item.length > 0)
      return entries.length > 0 ? `[${entries.join("/")}]` : ""
    }
    if (layer.format === "lines") {
      if (presentValues.length === 0) return []
      const lines = presentValues.flatMap((line) => line.split(/\r\n?|\n/))
      if (prefix && lines[0] !== undefined) lines[0] = `${prefix}${lines[0]}`
      if (suffix && lines.at(-1) !== undefined) lines[lines.length - 1] += suffix
      return lines
    }
    return presentValues
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = `${prefix}${String(value)}${suffix}`
    return layer.format === "lines" ? text.split(/\r\n?|\n/) : text
  }
  throw new Error(
    `Text layer "${layer.id}" cannot serialize card field "${layer.field ?? layer.semanticPath ?? layer.id}".`,
  )
}

function sourceText(value: string | readonly string[]) {
  return typeof value === "string" ? value : value.join("\n")
}

function sourceLines(value: string | readonly string[]) {
  if (typeof value === "string") return value.split(/\r\n?|\n/)
  return value.flatMap((line) => line.split(/\r\n?|\n/))
}

function splitPlainFitBlocks(source: readonly string[], typography: TextTypography) {
  if (
    typography.fitBlocks?.split !== "leading-authored-line" ||
    !hasLeadingAuthoredLineFitSplit(source.join("\n"))
  ) {
    return { remainder: source }
  }
  return { leading: source.slice(0, 1), remainder: source.slice(1) }
}

function textTokens(text: string) {
  return text.match(/\S+|\s+/gu) ?? [text]
}

function isWordSeparator(tokens: readonly string[], index: number) {
  const token = tokens[index]
  return Boolean(
    token &&
    /\s/u.test(token) &&
    index > 0 &&
    /\S/u.test(tokens[index - 1] ?? "") &&
    /\S/u.test(tokens[index + 1] ?? ""),
  )
}

function justifiedLine(
  line: TextLayoutLine,
  lineIndex: number,
  layer: TextLayer,
  typography: TextTypography,
  fittedTypography: TextTypography,
  measureText: TextMeasurer,
  lineHeight: number,
): readonly SvgElementDefinition[] | undefined {
  if (typography.textAlign !== "justify" || line.paragraphEnd) {
    return undefined
  }
  const maxWidth = typography.maxWidth
  if (maxWidth === undefined) return undefined

  const tokens = textTokens(line.text)
  const separatorCount = tokens.reduce(
    (count, _token, index) => count + (isWordSeparator(tokens, index) ? 1 : 0),
    0,
  )
  if (separatorCount === 0) return undefined

  const naturalWidth = measureText(line.text, fittedTypography) * line.autoScaleX
  const extraSpace = (maxWidth - naturalWidth) / separatorCount
  if (!(extraSpace > 0)) return undefined

  const anchorOffset =
    typography.textAnchor === "middle"
      ? maxWidth / 2
      : typography.textAnchor === "end"
        ? maxWidth
        : 0
  let x = layer.position.x - anchorOffset
  return tokens.map((token, tokenIndex) => {
    const element: SvgElementDefinition = {
      attributes: {
        ...(tokenIndex === 0 ? { dy: lineIndex === 0 ? 0 : lineHeight } : {}),
        "text-anchor": "start",
        x,
      },
      tag: "tspan",
      text: token,
    }
    const tokenWidth = measureText(token, fittedTypography)
    if (line.autoScaleX < 1 && tokenWidth > 0) {
      element.attributes = {
        ...element.attributes,
        lengthAdjust: "spacingAndGlyphs",
        textLength: stableLayoutNumber(tokenWidth * line.autoScaleX),
      }
    }
    x += tokenWidth * line.autoScaleX
    if (tokenIndex < tokens.length - 1) {
      x += (fittedTypography.letterSpacing ?? 0) * line.autoScaleX
    }
    if (isWordSeparator(tokens, tokenIndex)) x += extraSpace
    return element
  })
}

interface RichInlineStyle {
  align?: "center" | "justify" | "left" | "right"
  compression: number
  nocompress: boolean
  nowrap: boolean
  rubyText?: string
  scaleY: number
  shiftX: number
  shiftY: number
  verticalAlign?: "sub" | "super"
  typography: TextTypography
}

interface RichTextToken {
  kind: "space" | "text"
  length?: RichTextLength
  style: RichInlineStyle
  text?: string
}

interface RichLine {
  autoScaleX: number
  paragraphEnd: boolean
  tokens: readonly RichTextToken[]
}

function initialRichStyle(typography: TextTypography): RichInlineStyle {
  return {
    compression: 1,
    nocompress: false,
    nowrap: false,
    scaleY: 1,
    shiftX: 0,
    shiftY: 0,
    typography,
  }
}

function cloneRichStyle(style: RichInlineStyle): RichInlineStyle {
  return { ...style, typography: { ...style.typography } }
}

function lengthInPixels(length: RichTextLength, fontSize: number) {
  return length.unit === "em" ? length.value * fontSize : length.value
}

function applyRichElement(style: RichInlineStyle, node: RichTextElementNode): RichInlineStyle {
  const next = cloneRichStyle(style)
  const value = node.attributes.value
  switch (node.tag) {
    case "b":
      next.typography.fontWeight = "bold"
      break
    case "i":
      next.typography.fontStyle = "italic"
      break
    case "color":
      if (node.attributes.value) next.typography.fill = node.attributes.value
      break
    case "scale": {
      const scaleX = node.attributes.x
      if (scaleX !== undefined) next.compression *= Number.parseFloat(scaleX)
      const scaleY = node.attributes.y
      if (scaleY !== undefined) {
        const verticalScale = Number.parseFloat(scaleY)
        next.scaleY *= verticalScale
        next.typography = {
          ...next.typography,
          fontSize: next.typography.fontSize * verticalScale,
        }
      }
      break
    }
    case "nowrap":
      next.nowrap = true
      if (node.attributes.align === "justify") next.align = "justify"
      break
    case "nocompress":
      next.nocompress = true
      break
    case "size": {
      const length = value ? parseRichTextLength(value) : undefined
      if (length) next.typography.fontSize = lengthInPixels(length, style.typography.fontSize)
      break
    }
    case "tracking": {
      const length = value ? parseRichTextLength(value, true) : undefined
      if (length) next.typography.letterSpacing = lengthInPixels(length, style.typography.fontSize)
      break
    }
    case "shift": {
      const x = node.attributes.x ? parseRichTextLength(node.attributes.x, true) : undefined
      const y = node.attributes.y ? parseRichTextLength(node.attributes.y, true) : undefined
      if (x) next.shiftX += lengthInPixels(x, style.typography.fontSize)
      if (y) next.shiftY += lengthInPixels(y, style.typography.fontSize)
      break
    }
    case "sub":
      next.verticalAlign = "sub"
      next.typography.fontSize = style.typography.fontSize * 0.7
      next.shiftX -= style.typography.fontSize * 0.1
      break
    case "align":
      if (value === "left" || value === "center" || value === "right" || value === "justify") {
        next.align = value
      }
      break
    case "ruby":
      if (node.attributes.text !== undefined) next.rubyText = node.attributes.text
      break
    case "space":
      break
    case "sup":
      next.verticalAlign = "super"
      next.typography.fontSize = style.typography.fontSize * 0.7
      next.shiftX -= style.typography.fontSize * 0.1
      break
  }
  return next
}

function appendRichTextTokens(tokens: RichTextToken[], text: string, style: RichInlineStyle) {
  const normalized = text.replace(/\r\n?/gu, "\n")
  const lines = normalized.split("\n")
  lines.forEach((line, lineIndex) => {
    const pieces = line.match(/\S+\s*|\s+/gu) ?? []
    pieces.forEach((piece) =>
      tokens.push({ kind: "text", style: cloneRichStyle(style), text: piece }),
    )
    if (lineIndex < lines.length - 1)
      tokens.push({ kind: "text", style: cloneRichStyle(style), text: "\n" })
  })
}

function flattenRichNodes(
  nodes: readonly RichTextNode[],
  style: RichInlineStyle,
  output: RichTextToken[],
) {
  nodes.forEach((node) => {
    if (node.kind === "text") {
      appendRichTextTokens(output, node.text, style)
      return
    }
    if (node.tag === "space") {
      const width = node.attributes.width ? parseRichTextLength(node.attributes.width) : undefined
      if (width) output.push({ kind: "space", length: width, style: cloneRichStyle(style) })
      return
    }
    const childStyle = applyRichElement(style, node)
    flattenRichNodes(node.children, childStyle, output)
  })
}

function richTokens(document: RichTextDocument, typography: TextTypography) {
  const output: RichTextToken[] = []
  flattenRichNodes(document.children, initialRichStyle(typography), output)
  return output
}

function richTokenWidth(token: RichTextToken, measureText: TextMeasurer, autoScaleX = 1) {
  if (token.kind === "space") {
    const width = token.length ? lengthInPixels(token.length, token.style.typography.fontSize) : 0
    return (width / token.style.scaleY) * (token.style.nocompress ? 1 : autoScaleX)
  }
  const automaticScale = token.style.nocompress ? 1 : autoScaleX
  return (
    (measureText(token.text ?? "", token.style.typography) / token.style.scaleY) *
    token.style.compression *
    automaticScale
  )
}

function richLineWidth(
  tokens: readonly RichTextToken[],
  measureText: TextMeasurer,
  autoScaleX = 1,
) {
  return tokens.reduce((total, token) => total + richTokenWidth(token, measureText, autoScaleX), 0)
}

interface RichTokenRun {
  compression: number
  carryShiftX: boolean
  nocompress: boolean
  nowrap: boolean
  scaleY: number
  shiftX: number
  shiftY: number
  tokens: RichTextToken[]
}

function richTokenRuns(tokens: readonly RichTextToken[]) {
  const runs: RichTokenRun[] = []
  tokens.forEach((token) => {
    const compression = token.style.compression
    const carryShiftX = token.style.verticalAlign !== undefined
    const nocompress = token.style.nocompress
    const nowrap = token.style.nowrap
    const scaleY = token.style.scaleY
    const shiftX = token.style.shiftX
    const shiftY = token.style.shiftY
    const previous = runs.at(-1)
    if (
      previous?.compression === compression &&
      previous.carryShiftX === carryShiftX &&
      previous.nocompress === nocompress &&
      previous.nowrap === nowrap &&
      previous.scaleY === scaleY &&
      previous.shiftX === shiftX &&
      previous.shiftY === shiftY
    ) {
      previous.tokens.push(token)
    } else {
      runs.push({
        compression,
        carryShiftX,
        nocompress,
        nowrap,
        scaleY,
        shiftX,
        shiftY,
        tokens: [token],
      })
    }
  })
  return runs
}

/**
 * Returns a local horizontal compression ratio for each contiguous, automatically fitted nowrap
 * run. Explicit horizontal scale values already define their own width and are excluded from this
 * pass.
 * A nowrap run is kept at its authored font size and receives SVG textLength instead of shrinking
 * the parent text element. nocompress runs reserve their natural width and are never included in
 * the ratio.
 */
function nowrapCompressionRatios(
  runs: readonly RichTokenRun[],
  maxWidth: number | undefined,
  measureText: TextMeasurer | undefined,
  autoScaleX = 1,
) {
  const automaticRatios = runs.map((run) => (run.nocompress ? 1 : autoScaleX))
  const ratios = [...automaticRatios]
  if (maxWidth === undefined || measureText === undefined) return ratios

  const widths = runs.map(
    (run, index) => richLineWidth(run.tokens, measureText) * (automaticRatios[index] ?? 1),
  )
  const lineWidth = widths.reduce((total, width) => total + width, 0)
  if (lineWidth <= maxWidth) return ratios

  const compressibleWidth = runs.reduce(
    (total, run, index) =>
      total + (run.nowrap && !run.nocompress && run.compression === 1 ? (widths[index] ?? 0) : 0),
    0,
  )
  if (compressibleWidth <= 0) return ratios

  const fixedWidth = lineWidth - compressibleWidth
  const availableWidth = maxWidth - fixedWidth
  // If fixed content already overflows, this is the best possible horizontal fit while retaining
  // the fixed content's authored width. Normal wrapping handles the common case before reaching
  // this fallback.
  const ratio = Math.min(
    1,
    Math.max(0.01, availableWidth > 0 ? availableWidth / compressibleWidth : maxWidth / lineWidth),
  )
  runs.forEach((run, index) => {
    if (run.nowrap && !run.nocompress && run.compression === 1) {
      ratios[index] = autoScaleX * ratio
    }
  })
  return ratios
}

function splitRichParagraphs(tokens: readonly RichTextToken[]) {
  const paragraphs: RichTextToken[][] = [[]]
  tokens.forEach((token) => {
    if (token.kind === "text" && token.text === "\n") paragraphs.push([])
    else paragraphs.at(-1)?.push(token)
  })
  return paragraphs
}

function splitLongRichToken(
  token: RichTextToken,
  maxWidth: number,
  measureText: TextMeasurer,
  autoScaleX = 1,
) {
  if (token.kind === "space" || token.style.nowrap || !token.text) return [[token]]
  const pieces: RichTextToken[][] = []
  let current: RichTextToken | undefined
  for (const character of graphemeSegments(token.text)) {
    const nextText = `${current?.text ?? ""}${character}`
    const next: RichTextToken = {
      kind: "text",
      style: cloneRichStyle(token.style),
      text: nextText,
    }
    if (current && richTokenWidth(next, measureText, autoScaleX) > maxWidth) {
      pieces.push([current])
      current = {
        kind: "text",
        style: cloneRichStyle(token.style),
        text: character,
      }
    } else {
      current = next
    }
  }
  if (current) pieces.push([current])
  return pieces.length > 0 ? pieces : [[token]]
}

function richWrapParagraph(
  tokens: readonly RichTextToken[],
  maxWidth: number,
  measureText: TextMeasurer,
  autoScaleX = 1,
): readonly RichTextToken[][] {
  if (tokens.length === 0) return [[]]
  const lines: RichTextToken[][] = []
  let current: RichTextToken[] = []
  let currentWidth = 0

  const units: RichTextToken[][] = []
  tokens.forEach((token) => {
    const previous = units.at(-1)?.at(-1)
    if (token.style.nowrap && previous?.style.nowrap) {
      units.at(-1)?.push(token)
    } else {
      units.push([token])
    }
  })

  const pushCurrent = () => {
    if (current.length > 0) lines.push(current)
    current = []
    currentWidth = 0
  }

  units.forEach((unit) => {
    const width = richLineWidth(unit, measureText, autoScaleX)
    if (current.length > 0 && currentWidth + width > maxWidth) pushCurrent()
    if (width <= maxWidth || unit.some((token) => token.style.nowrap)) {
      current.push(...unit)
      currentWidth += width
      return
    }
    if (unit.length !== 1) {
      current.push(...unit)
      currentWidth += width
      return
    }
    const pieces = splitLongRichToken(unit[0] as RichTextToken, maxWidth, measureText, autoScaleX)
    pieces.forEach((piece) => {
      const pieceWidth = richLineWidth(piece, measureText, autoScaleX)
      if (current.length > 0 && currentWidth + pieceWidth > maxWidth) pushCurrent()
      current.push(...piece)
      currentWidth += pieceWidth
      if (currentWidth >= maxWidth) pushCurrent()
    })
  })
  pushCurrent()
  return lines.length > 0 ? lines : [[]]
}

function richLinesForParagraphs(
  paragraphs: readonly (readonly RichTextToken[])[],
  typography: TextTypography,
  measureText?: TextMeasurer,
  autoScaleX = 1,
): readonly RichLine[] {
  const lines: RichLine[] = []
  paragraphs.forEach((paragraph) => {
    const wrapped =
      typography.wrap === "word" && typography.maxWidth !== undefined && measureText
        ? richWrapParagraph(paragraph, typography.maxWidth, measureText, autoScaleX)
        : [paragraph]
    wrapped.forEach((line, index) =>
      lines.push({ autoScaleX, paragraphEnd: index === wrapped.length - 1, tokens: line }),
    )
  })
  return lines.length > 0 ? lines : [{ autoScaleX, paragraphEnd: true, tokens: [] }]
}

function richLines(
  document: RichTextDocument,
  typography: TextTypography,
  measureText?: TextMeasurer,
  autoScaleX = 1,
) {
  return richLinesForParagraphs(
    splitRichParagraphs(richTokens(document, typography)),
    typography,
    measureText,
    autoScaleX,
  )
}

function splitRichFitBlocks(
  hasValidSplit: boolean,
  paragraphs: readonly (readonly RichTextToken[])[],
  typography: TextTypography,
) {
  if (typography.fitBlocks?.split !== "leading-authored-line" || !hasValidSplit) {
    return { remainder: paragraphs }
  }
  return { leading: paragraphs.slice(0, 1), remainder: paragraphs.slice(1) }
}

function scaleRichLines(lines: readonly RichLine[], scale: number): readonly RichLine[] {
  if (scale === 1) return lines
  return lines.map((line) => ({
    ...line,
    tokens: line.tokens.map((token) => ({
      ...token,
      style: {
        ...token.style,
        shiftX: token.style.shiftX * scale,
        shiftY: token.style.shiftY * scale,
        typography: {
          ...token.style.typography,
          fontSize: token.style.typography.fontSize * scale,
          ...(token.style.typography.letterSpacing === undefined
            ? {}
            : { letterSpacing: token.style.typography.letterSpacing * scale }),
        },
      },
    })),
  }))
}

function richLineExplicitAlignment(line: RichLine): RichInlineStyle["align"] | undefined {
  return line.tokens.find((token) => token.style.align)?.style.align
}

function richLineAlignment(
  line: RichLine,
  typography: TextTypography,
): RichInlineStyle["align"] | undefined {
  const explicit = richLineExplicitAlignment(line)
  if (explicit) return explicit
  if (typography.textAnchor === "middle") return "center"
  if (typography.textAnchor === "end") return "right"
  return undefined
}

function richLinePosition(
  layer: TextLayer,
  line: RichLine,
  typography: TextTypography,
  alignment: RichInlineStyle["align"] | undefined,
) {
  const explicitAlignment = richLineExplicitAlignment(line)
  if (explicitAlignment && typography.maxWidth !== undefined) {
    if (alignment === "center") return layer.position.x + typography.maxWidth / 2
    if (alignment === "right") return layer.position.x + typography.maxWidth
  }
  return layer.position.x
}

function richStyleAttributes(
  style: RichInlineStyle,
  baseTypography: TextTypography,
  extra: Readonly<Record<string, string | number>> = {},
) {
  const typography = style.typography
  return {
    "white-space": "pre",
    "xml:space": "preserve",
    ...(typography.fill !== baseTypography.fill ? { fill: typography.fill } : {}),
    ...(typography.fontFamily !== baseTypography.fontFamily
      ? { "font-family": typography.fontFamily }
      : {}),
    ...(typography.fontSize !== baseTypography.fontSize
      ? { "font-size": typography.fontSize }
      : {}),
    ...(style.verticalAlign
      ? { "baseline-shift": style.verticalAlign === "super" ? "0.36em" : "-0.12em" }
      : {}),
    ...(typography.fontStyle !== baseTypography.fontStyle && typography.fontStyle
      ? { "font-style": typography.fontStyle }
      : {}),
    ...(typography.fontWeight !== baseTypography.fontWeight && typography.fontWeight
      ? { "font-weight": typography.fontWeight }
      : {}),
    ...(typography.letterSpacing !== baseTypography.letterSpacing &&
    typography.letterSpacing !== undefined
      ? { "letter-spacing": typography.letterSpacing }
      : {}),
    ...extra,
  }
}

function rubySpan(
  token: RichTextToken,
  baseTypography: TextTypography,
  extra: Readonly<Record<string, string | number>>,
  measureText?: TextMeasurer,
): SvgElementDefinition {
  const style = token.style
  const typography = style.typography
  const annotationSize = Math.max(1, typography.fontSize * 0.5)
  const offset = Math.max(1, typography.fontSize * 0.65)
  const annotationText = style.rubyText ?? ""
  const annotationTypography = { ...typography, fontSize: annotationSize }
  const baseWidth = measureText ? richTokenWidth(token, measureText) : undefined
  const annotationWidth = measureText
    ? measureText(annotationText, annotationTypography)
    : undefined
  const annotationDx = baseWidth === undefined ? undefined : baseWidth / 2
  const baseDx =
    baseWidth === undefined || annotationWidth === undefined
      ? undefined
      : -(baseWidth / 2 + annotationWidth)
  return {
    attributes: richStyleAttributes(style, baseTypography, extra),
    children: [
      {
        attributes: {
          "font-size": annotationSize,
          "text-anchor": "middle",
          dy: -offset,
          ...(annotationDx === undefined ? {} : { dx: annotationDx }),
        },
        tag: "tspan",
        text: annotationText,
      },
      {
        attributes: {
          dy: offset,
          ...(baseDx === undefined ? {} : { dx: baseDx }),
        },
        tag: "tspan",
        text: token.text ?? "",
      },
    ],
    tag: "tspan",
  }
}

function richTokenChildren(
  tokens: readonly RichTextToken[],
  baseTypography: TextTypography,
  initialDx = 0,
  measureText?: TextMeasurer,
  shiftDx = 0,
  shiftDy = 0,
) {
  let pendingDx = initialDx
  let pendingShiftDx = shiftDx
  let pendingShiftDy = shiftDy
  const children: SvgElementDefinition[] = []
  tokens.forEach((token) => {
    if (token.kind === "space") {
      pendingDx += token.length ? lengthInPixels(token.length, token.style.typography.fontSize) : 0
      return
    }
    const dx = pendingDx + pendingShiftDx
    const extra = {
      ...(dx === 0 ? {} : { dx }),
      ...(pendingShiftDy === 0 ? {} : { dy: pendingShiftDy }),
    }
    pendingDx = 0
    pendingShiftDx = 0
    pendingShiftDy = 0
    children.push(
      token.style.rubyText === undefined
        ? {
            attributes: richStyleAttributes(token.style, baseTypography, extra),
            tag: "tspan",
            text: token.text ?? "",
          }
        : rubySpan(token, baseTypography, extra, measureText),
    )
  })
  const trailingDx = pendingDx + pendingShiftDx
  if (trailingDx !== 0 || pendingShiftDy !== 0) {
    children.push({
      attributes: {
        ...(trailingDx === 0 ? {} : { dx: trailingDx }),
        ...(pendingShiftDy === 0 ? {} : { dy: pendingShiftDy }),
        "white-space": "pre",
        "xml:space": "preserve",
      },
      tag: "tspan",
    })
  }
  return children
}

function createRichTextElement(
  layer: TextLayer,
  document: RichTextDocument,
  measureText: TextMeasurer | undefined,
  fitProfileId: string | undefined,
  baseTypography: TextTypography,
) {
  const profiles = baseTypography.fitProfiles
  const hasValidFitBlockSplit = hasLeadingAuthoredLineFitSplit(document)
  const layoutForProfile = (
    profile: TextFitProfile,
  ): TextProfileLayout<RichLine> & {
    fits: boolean
  } => {
    const typography = typographyForFitProfile(baseTypography, profile)
    const paragraphs = splitRichParagraphs(richTokens(document, typography))
    const blocks = splitRichFitBlocks(hasValidFitBlockSplit, paragraphs, typography)
    const preferredMaxLines = typography.fitBlocks?.leading.preferredMaxLines ?? 1
    const leadingScale = blocks.leading
      ? (largestFittingAutoScaleX(
          profile,
          typography,
          (scale) =>
            richLinesForParagraphs(blocks.leading ?? [], typography, measureText, scale).length <=
            preferredMaxLines,
        ) ?? 1)
      : 1
    const leading = blocks.leading
      ? richLinesForParagraphs(blocks.leading, typography, measureText, leadingScale)
      : ([] as const)
    const remainderAt = (scale: number) =>
      richLinesForParagraphs(blocks.remainder, typography, measureText, scale)
    const fitsAt = (scale: number) => {
      const lines = [...leading, ...remainderAt(scale)]
      if (!linesFitProfile(lines.length, profile, typography)) return false
      if (layer.format === "type-list" && measureText && typography.maxWidth !== undefined) {
        const widestLine = Math.max(
          0,
          ...lines.map((line) => richLineWidth(line.tokens, measureText, line.autoScaleX)),
        )
        if (widestLine > typography.maxWidth) return false
      }
      return true
    }
    const fittingScale = largestFittingAutoScaleX(profile, typography, fitsAt)
    const remainderScale = fittingScale ?? smallestQuantifiedAutoScaleX(profile, typography)
    return {
      fits: fittingScale !== undefined,
      lines: [...leading, ...remainderAt(remainderScale)],
      profile,
      typography,
    }
  }

  let layout: TextProfileLayout<RichLine>
  if (profiles && profiles.length > 0) {
    const pinned = fitProfileId
      ? profiles.find((profile) => profile.id === fitProfileId)
      : undefined
    if (pinned) {
      layout = layoutForProfile(pinned)
    } else {
      let fallback: TextProfileLayout<RichLine> | undefined
      let accepted: TextProfileLayout<RichLine> | undefined
      for (const profile of profiles) {
        const candidate = layoutForProfile(profile)
        fallback = candidate
        if (candidate.fits) {
          accepted = candidate
          break
        }
      }
      layout = accepted ?? (fallback as TextProfileLayout<RichLine>)
    }
  } else {
    layout = {
      lines: richLines(document, baseTypography, measureText),
      typography: baseTypography,
    }
  }

  const typography = layout.typography
  const lines = layout.lines
  const widestLine = measureText
    ? Math.max(0, ...lines.map((line) => richLineWidth(line.tokens, measureText, line.autoScaleX)))
    : 0
  const hasNocompress = lines.some((line) => line.tokens.some((token) => token.style.nocompress))
  const hasNowrap = lines.some((line) => line.tokens.some((token) => token.style.nowrap))
  const hasCustomCompression = lines.some((line) =>
    line.tokens.some((token) => token.style.compression !== 1),
  )
  const measuredScale =
    typography.maxWidth && widestLine > typography.maxWidth ? typography.maxWidth / widestLine : 1
  const minimumScale = typography.minFontSize ? typography.minFontSize / typography.fontSize : 0
  const fontScale =
    profiles || hasNocompress || hasNowrap || hasCustomCompression
      ? 1
      : typography.fit === "scale-x"
        ? 1
        : Math.max(measuredScale, minimumScale)
  const fittedFontSize = typography.fontSize * fontScale
  const fittedTypography = { ...typography, fontSize: fittedFontSize }
  const fittedLines = scaleRichLines(lines, fontScale)
  const attributes: Record<string, string | number> = {
    fill: typography.fill,
    "font-family": typography.fontFamily,
    "font-size": fittedFontSize,
    ...strokeAttributes(typography.stroke, fontScale),
    "white-space": "pre",
    x: layer.position.x,
    y: layer.position.y,
  }
  if (typography.textAnchor) attributes["text-anchor"] = typography.textAnchor
  if (typography.verticalAnchor === "top") {
    attributes["dominant-baseline"] = "text-before-edge"
  }
  if (typography.fontStyle) attributes["font-style"] = typography.fontStyle
  if (typography.fontWeight) attributes["font-weight"] = typography.fontWeight
  if (typography.letterSpacing !== undefined) {
    attributes["letter-spacing"] = typography.letterSpacing * fontScale
  }

  const lineHeight = (typography.lineHeight ?? typography.fontSize) * fontScale
  const children: SvgElementDefinition[] = []
  fittedLines.forEach((line, lineIndex) => {
    const renderedAutoScaleX =
      typography.fit === "scale-x" ? line.autoScaleX * measuredScale : line.autoScaleX
    const explicitAlignment = richLineExplicitAlignment(line)
    const alignment = richLineAlignment(line, typography)
    const lineX = richLinePosition(layer, line, typography, alignment)
    const lineAttributes: Record<string, string | number> = {
      dy: lineIndex === 0 ? 0 : lineHeight,
      x: lineX,
      "white-space": "pre",
      "xml:space": "preserve",
    }
    if (alignment === "center") lineAttributes["text-anchor"] = "middle"
    if (alignment === "right") lineAttributes["text-anchor"] = "end"
    if (alignment === "left" || alignment === "justify") lineAttributes["text-anchor"] = "start"
    // Inline alignment is authoritative. Without an inline override, use the template's
    // justification policy for soft-wrapped non-final lines. Compression only changes the
    // measured width of its own run and must not disable line-level justification.
    const isJustified =
      explicitAlignment !== undefined
        ? explicitAlignment === "justify"
        : typography.textAlign === "justify" && !line.paragraphEnd
    const lineWidth = measureText ? richLineWidth(line.tokens, measureText, renderedAutoScaleX) : 0
    const shouldStretch =
      isJustified &&
      typography.maxWidth !== undefined &&
      !line.tokens.some((token) => token.style.nocompress) &&
      lineWidth < typography.maxWidth
    if (shouldStretch) {
      lineAttributes.lengthAdjust = renderedAutoScaleX < 1 ? "spacing" : "spacingAndGlyphs"
      const maxWidth = typography.maxWidth
      if (maxWidth !== undefined) lineAttributes.textLength = maxWidth
    }

    const lineChildren: SvgElementDefinition[] = []
    let pendingDx = 0
    let activeShiftX = 0
    let activeShiftY = 0
    const runs = richTokenRuns(line.tokens)
    const compressionRatios = nowrapCompressionRatios(
      runs,
      typography.maxWidth,
      measureText,
      renderedAutoScaleX,
    )
    runs.forEach((run, runIndex) => {
      const ratio = compressionRatios[runIndex] ?? 1
      const runWidth = measureText ? richLineWidth(run.tokens, measureText) : 0
      const hasExplicitScale = run.compression !== 1 || run.scaleY !== 1
      const hasAutomaticCompression = ratio !== 1
      const previousRun = runs[runIndex - 1]
      const previousShiftX = previousRun?.carryShiftX ? 0 : activeShiftX
      const shiftDx = run.shiftX - previousShiftX
      const shiftDy = run.shiftY - activeShiftY
      if ((!hasExplicitScale && !hasAutomaticCompression) || runWidth === 0) {
        lineChildren.push(
          ...richTokenChildren(
            run.tokens,
            fittedTypography,
            pendingDx,
            measureText,
            shiftDx,
            shiftDy,
          ),
        )
        pendingDx = 0
        activeShiftX = run.shiftX
        activeShiftY = run.shiftY
        return
      }
      const attributes: Record<string, string | number> = {
        "white-space": "pre",
        "xml:space": "preserve",
      }
      if (pendingDx + shiftDx !== 0) attributes.dx = pendingDx + shiftDx
      if (shiftDy !== 0) attributes.dy = shiftDy
      pendingDx = 0
      attributes.lengthAdjust = "spacingAndGlyphs"
      attributes.textLength = stableLayoutNumber(runWidth * ratio)
      lineChildren.push({
        attributes,
        children: richTokenChildren(run.tokens, fittedTypography, 0, measureText),
        tag: "tspan",
      })
      activeShiftX = run.shiftX
      activeShiftY = run.shiftY
    })
    if (pendingDx !== 0) {
      lineChildren.push({
        attributes: { dx: pendingDx, "white-space": "pre", "xml:space": "preserve" },
        tag: "tspan",
      })
    }
    children.push({ attributes: lineAttributes, children: lineChildren, tag: "tspan" })
  })

  return { attributes, children, tag: "text" } satisfies SvgElementDefinition
}

function createPlainTextElement(
  layer: TextLayer,
  value: string | readonly string[],
  measureText: TextMeasurer | undefined,
  fitProfileId: string | undefined,
  baseTypography: TextTypography,
) {
  const source = sourceLines(value)
  const blocks = splitPlainFitBlocks(source, baseTypography)
  const wrappedLines = (
    block: readonly string[],
    typography: TextTypography,
    autoScaleX: number,
  ): readonly TextLayoutLine[] => {
    const wrapWidth = typography.wrap === "word" ? typography.maxWidth : undefined
    if (!wrapWidth || !measureText) {
      return block.map((text) => ({ autoScaleX: 1, paragraphEnd: true, text }))
    }
    const scaledMeasure: TextMeasurer = (text, measuredTypography) =>
      measureText(text, measuredTypography) * autoScaleX
    return block.flatMap((line) => {
      const wrapped = wrapLine(line, wrapWidth, typography, scaledMeasure)
      return wrapped.map((text, index) => ({
        autoScaleX,
        paragraphEnd: index === wrapped.length - 1,
        text,
      }))
    })
  }

  const layoutForProfile = (
    profile: TextFitProfile,
  ): TextProfileLayout<TextLayoutLine> & {
    fits: boolean
  } => {
    const typography = typographyForFitProfile(baseTypography, profile)
    const preferredMaxLines = baseTypography.fitBlocks?.leading.preferredMaxLines ?? 1
    const leadingScale = blocks.leading
      ? (largestFittingAutoScaleX(
          profile,
          typography,
          (scale) =>
            wrappedLines(blocks.leading ?? [], typography, scale).length <= preferredMaxLines,
        ) ?? 1)
      : 1
    const leading = blocks.leading
      ? wrappedLines(blocks.leading, typography, leadingScale)
      : ([] as const)
    const remainderAt = (scale: number) => wrappedLines(blocks.remainder, typography, scale)
    const fitsAt = (scale: number) => {
      const remainder = remainderAt(scale)
      const lines = [...leading, ...remainder]
      if (!linesFitProfile(lines.length, profile, typography)) return false
      if (layer.format === "type-list" && measureText && typography.maxWidth !== undefined) {
        const widestLine = Math.max(
          0,
          ...lines.map((line) => measureText(line.text, typography) * line.autoScaleX),
        )
        if (widestLine > typography.maxWidth) return false
      }
      return true
    }
    const fittingScale = largestFittingAutoScaleX(profile, typography, fitsAt)
    const remainderScale = fittingScale ?? smallestQuantifiedAutoScaleX(profile, typography)
    return {
      fits: fittingScale !== undefined,
      lines: [...leading, ...remainderAt(remainderScale)],
      profile,
      typography,
    }
  }

  const profiles = baseTypography.fitProfiles
  let layout: TextProfileLayout<TextLayoutLine>
  if (profiles && profiles.length > 0) {
    const pinned = fitProfileId
      ? profiles.find((profile) => profile.id === fitProfileId)
      : undefined
    if (pinned) {
      layout = layoutForProfile(pinned)
    } else {
      let fallback: TextProfileLayout<TextLayoutLine> | undefined
      let accepted: TextProfileLayout<TextLayoutLine> | undefined
      for (const profile of profiles) {
        const candidate = layoutForProfile(profile)
        fallback = candidate
        if (candidate.fits) {
          accepted = candidate
          break
        }
      }
      layout = accepted ?? (fallback as TextProfileLayout<TextLayoutLine>)
    }
  } else {
    layout = {
      lines: wrappedLines(source, baseTypography, 1),
      typography: baseTypography,
    }
  }

  const typography = layout.typography
  const lines = layout.lines
  const widestLine = measureText
    ? Math.max(0, ...lines.map((line) => measureText(line.text, typography) * line.autoScaleX))
    : 0
  const measuredScale =
    typography.maxWidth && widestLine > typography.maxWidth ? typography.maxWidth / widestLine : 1
  const minimumScale = typography.minFontSize ? typography.minFontSize / typography.fontSize : 0
  const fontScale =
    profiles || typography.fit === "scale-x" ? 1 : Math.max(measuredScale, minimumScale)
  const fittedFontSize = typography.fontSize * fontScale
  const fittedTypography = { ...typography, fontSize: fittedFontSize }
  const attributes: Record<string, string | number> = {
    fill: typography.fill,
    "font-family": typography.fontFamily,
    "font-size": fittedFontSize,
    ...strokeAttributes(typography.stroke, fontScale),
    "white-space": "pre",
    "xml:space": "preserve",
    x: layer.position.x,
    y: layer.position.y,
  }
  if (typography.textAnchor) attributes["text-anchor"] = typography.textAnchor
  if (typography.verticalAnchor === "top") {
    attributes["dominant-baseline"] = "text-before-edge"
  }
  if (typography.fontStyle) attributes["font-style"] = typography.fontStyle
  if (typography.fontWeight) attributes["font-weight"] = typography.fontWeight
  if (typography.letterSpacing !== undefined) {
    attributes["letter-spacing"] = typography.letterSpacing * fontScale
  }

  const renderedLineScale = (line: TextLayoutLine) =>
    typography.fit === "scale-x" ? line.autoScaleX * measuredScale : line.autoScaleX

  if (layer.format === "lines" || lines.length > 1) {
    return {
      attributes,
      children: lines.flatMap((line, index) => {
        const lineHeight = (typography.lineHeight ?? typography.fontSize) * fontScale
        const renderedLine = { ...line, autoScaleX: renderedLineScale(line) }
        const justified = measureText
          ? justifiedLine(
              renderedLine,
              index,
              layer,
              typography,
              fittedTypography,
              measureText,
              lineHeight,
            )
          : undefined
        if (justified) return justified
        const naturalWidth = measureText ? measureText(line.text, fittedTypography) : 0
        const lineAttributes: Record<string, string | number> = {
          dy: index === 0 ? 0 : lineHeight,
          x: layer.position.x,
        }
        if (renderedLine.autoScaleX < 1 && naturalWidth > 0) {
          lineAttributes.lengthAdjust = "spacingAndGlyphs"
          lineAttributes.textLength = stableLayoutNumber(naturalWidth * renderedLine.autoScaleX)
        }
        return [{ attributes: lineAttributes, tag: "tspan", text: line.text }]
      }),
      tag: "text",
    }
  }

  const line = lines[0]
  const lineScale = line ? renderedLineScale(line) : 1
  const naturalWidth = line && measureText ? measureText(line.text, fittedTypography) : 0
  if (lineScale < 1 && naturalWidth > 0) {
    attributes.lengthAdjust = "spacingAndGlyphs"
    attributes.textLength = stableLayoutNumber(naturalWidth * lineScale)
  }
  return { attributes, tag: "text", text: line?.text ?? "" }
}

export function createTextElement(
  card: CardData,
  layer: TextLayer,
  measureText?: TextMeasurer,
  options: TextLayoutOptions = {},
): SvgElementDefinition {
  const value = textValue(card, layer, options.semanticValue)
  const source = sourceText(value)
  const parsed = parseRichText(source)
  parsed.warnings.forEach((warning) => options.onWarning?.(warning))
  const plainText = plainTextFromRichText(parsed.document)
  const baseTypography = options.typography ?? layer.typography
  if (richTextHasFormatting(parsed.document)) {
    return createRichTextElement(
      layer,
      parsed.document,
      measureText,
      options.fitProfileId,
      baseTypography,
    )
  }
  return createPlainTextElement(layer, plainText, measureText, options.fitProfileId, baseTypography)
}
