/**
 * The serialized card-text format is deliberately small and is not HTML. Keeping its parser
 * separate from the SVG renderer lets the editor, preview, and export share the same validation
 * and escaping rules without handing user-authored markup to a browser HTML parser.
 */

export type RichTextTagName =
  | "align"
  | "b"
  | "color"
  | "scale"
  | "i"
  | "nocompress"
  | "nowrap"
  | "ruby"
  | "shift"
  | "size"
  | "space"
  | "sub"
  | "sup"
  | "tracking"

export type RichTextWarningCode =
  | "invalid-attribute"
  | "invalid-value"
  | "malformed-tag"
  | "mismatched-closing-tag"
  | "unknown-tag"
  | "unclosed-tag"

export interface RichTextWarning {
  readonly code: RichTextWarningCode
  readonly length: number
  readonly message: string
  readonly offset: number
}

export interface RichTextTextNode {
  readonly kind: "text"
  readonly text: string
}

export interface RichTextElementNode {
  readonly attributes: Readonly<Record<string, string>>
  readonly children: readonly RichTextNode[]
  readonly kind: "element"
  readonly tag: RichTextTagName
}

export type RichTextNode = RichTextElementNode | RichTextTextNode

export interface RichTextDocument {
  readonly children: readonly RichTextNode[]
  readonly source: string
}

export interface RichTextParseResult {
  readonly document: RichTextDocument
  readonly warnings: readonly RichTextWarning[]
}

export interface RichTextLength {
  readonly unit: "em" | "px"
  readonly value: number
}

const tagNames = new Set<RichTextTagName>([
  "align",
  "b",
  "color",
  "scale",
  "i",
  "nocompress",
  "nowrap",
  "ruby",
  "shift",
  "size",
  "space",
  "sub",
  "sup",
  "tracking",
])

const tagAttributes: Readonly<Record<RichTextTagName, readonly string[]>> = {
  align: ["value"],
  b: [],
  color: ["value"],
  scale: ["x", "y"],
  i: [],
  nocompress: [],
  nowrap: ["align"],
  ruby: ["text"],
  shift: ["x", "y"],
  size: ["value"],
  space: ["width"],
  sub: [],
  sup: [],
  tracking: ["value"],
}

const alignmentValues = new Set(["left", "center", "right", "justify"])
const nowrapAlignmentValues = new Set(["justify"])

function warning(
  warnings: RichTextWarning[],
  code: RichTextWarningCode,
  message: string,
  offset: number,
  length: number,
) {
  warnings.push({ code, length, message, offset })
}

function appendText(children: RichTextNode[], text: string) {
  if (text.length === 0) return
  const previous = children.at(-1)
  if (previous?.kind === "text") {
    children[children.length - 1] = { kind: "text", text: `${previous.text}${text}` }
  } else {
    children.push({ kind: "text", text })
  }
}

function isWhitespace(character: string | undefined) {
  return character !== undefined && /\s/u.test(character)
}

function isNameStart(character: string | undefined) {
  return character !== undefined && /[A-Za-z]/u.test(character)
}

function isNameCharacter(character: string | undefined) {
  return character !== undefined && /[A-Za-z0-9_-]/u.test(character)
}

function findTagEnd(source: string, start: number) {
  let quote: string | undefined
  let escaped = false
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (quote && character === "\\") {
      escaped = true
      continue
    }
    if (quote) {
      if (character === quote) quote = undefined
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === ">") return index
  }
  return -1
}

function decodeAttributeValue(value: string) {
  return value.replaceAll(/\\([<>\\"])/gu, "$1")
}

interface ParsedTag {
  readonly attributes: Readonly<Record<string, string>>
  readonly closing: boolean
  readonly name: string
  readonly selfClosing: boolean
}

function parseTag(source: string, start: number, end: number): ParsedTag | undefined {
  let index = start + 1
  const closing = source[index] === "/"
  if (closing) index += 1
  while (isWhitespace(source[index])) index += 1

  if (!isNameStart(source[index])) return undefined
  const nameStart = index
  while (isNameCharacter(source[index])) index += 1
  const name = source.slice(nameStart, index)

  if (closing) {
    while (isWhitespace(source[index])) index += 1
    if (index !== end) return undefined
    return { attributes: {}, closing: true, name, selfClosing: false }
  }

  const attributes: Record<string, string> = {}
  while (index < end) {
    while (isWhitespace(source[index])) index += 1
    if (index >= end) break
    if (source[index] === "/") {
      index += 1
      while (isWhitespace(source[index])) index += 1
      if (index !== end) return undefined
      return { attributes, closing: false, name, selfClosing: true }
    }
    if (!isNameStart(source[index])) return undefined
    const attributeStart = index
    while (isNameCharacter(source[index])) index += 1
    const attributeName = source.slice(attributeStart, index)
    while (isWhitespace(source[index])) index += 1
    if (source[index] !== "=") return undefined
    index += 1
    while (isWhitespace(source[index])) index += 1
    const quote = source[index]
    if (quote !== '"' && quote !== "'") return undefined
    index += 1
    let value = ""
    let closed = false
    while (index < end) {
      const character = source[index]
      if (character === "\\" && index + 1 < end) {
        value += source[index + 1]
        index += 2
        continue
      }
      if (character === quote) {
        closed = true
        index += 1
        break
      }
      value += character
      index += 1
    }
    if (!closed || attributeName in attributes) return undefined
    attributes[attributeName] = decodeAttributeValue(value)
  }
  return { attributes, closing: false, name, selfClosing: false }
}

function parseLength(value: string, allowNegative: boolean): RichTextLength | undefined {
  const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|em)$/u.exec(value.trim())
  if (!match) return undefined
  const parsed = Number(match[1])
  if (!Number.isFinite(parsed) || (!allowNegative && parsed < 0)) return undefined
  return { unit: match[2] as RichTextLength["unit"], value: parsed }
}

function parseCompression(value: string) {
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function validHexColor(value: string) {
  return /^#[0-9a-f]{3,4}$|^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu.test(value)
}

function validateTag(
  tag: ParsedTag,
  warnings: RichTextWarning[],
  offset: number,
  length: number,
): tag is ParsedTag & { name: RichTextTagName } {
  if (!tagNames.has(tag.name as RichTextTagName)) {
    warning(warnings, "unknown-tag", `Unknown rich-text tag <${tag.name}>.`, offset, length)
    return false
  }
  const name = tag.name as RichTextTagName
  const allowed = new Set(tagAttributes[name])
  const unknownAttribute = Object.keys(tag.attributes).find((attribute) => !allowed.has(attribute))
  if (unknownAttribute) {
    warning(
      warnings,
      "invalid-attribute",
      `Rich-text tag <${name}> does not support attribute "${unknownAttribute}".`,
      offset,
      length,
    )
    return false
  }
  if (tag.closing) {
    if (Object.keys(tag.attributes).length > 0) {
      warning(
        warnings,
        "invalid-attribute",
        `Closing rich-text tag </${name}> cannot have attributes.`,
        offset,
        length,
      )
      return false
    }
    return true
  }
  if (name === "space" && !tag.selfClosing) {
    warning(
      warnings,
      "malformed-tag",
      "The <space> rich-text tag must be self-closing.",
      offset,
      length,
    )
    return false
  }
  if (name !== "space" && tag.selfClosing) {
    warning(
      warnings,
      "malformed-tag",
      `The <${name}> rich-text tag must have a closing tag.`,
      offset,
      length,
    )
    return false
  }

  const requireAttribute = (attribute: string) => {
    if (tag.attributes[attribute] !== undefined && tag.attributes[attribute] !== "") return true
    warning(
      warnings,
      "invalid-attribute",
      `Rich-text tag <${name}> requires a non-empty "${attribute}" attribute.`,
      offset,
      length,
    )
    return false
  }
  if (name === "color") {
    if (!requireAttribute("value") || !validHexColor(tag.attributes.value ?? "")) {
      warning(
        warnings,
        "invalid-value",
        `Rich-text color must be a hexadecimal value such as "#ff0000".`,
        offset,
        length,
      )
      return false
    }
  }
  if (name === "scale") {
    const x = tag.attributes.x
    const y = tag.attributes.y
    if (
      (x === undefined && y === undefined) ||
      (x !== undefined && parseCompression(x) === undefined) ||
      (y !== undefined && parseCompression(y) === undefined)
    ) {
      warning(
        warnings,
        "invalid-value",
        `Rich-text scale requires x or y to be a positive finite number such as "0.75" or "1.25".`,
        offset,
        length,
      )
      return false
    }
  }
  if (name === "nowrap" && tag.attributes.align !== undefined) {
    if (!nowrapAlignmentValues.has(tag.attributes.align)) {
      warning(
        warnings,
        "invalid-value",
        `Rich-text nowrap align must be "justify".`,
        offset,
        length,
      )
      return false
    }
  }
  if (name === "ruby" && !requireAttribute("text")) return false
  if (name === "space") {
    if (!requireAttribute("width") || !parseLength(tag.attributes.width ?? "", false)) {
      warning(
        warnings,
        "invalid-value",
        `Rich-text space width must use a non-negative px or em length.`,
        offset,
        length,
      )
      return false
    }
  }
  if (name === "size" || name === "tracking") {
    if (
      !requireAttribute("value") ||
      !parseLength(tag.attributes.value ?? "", name === "tracking")
    ) {
      warning(
        warnings,
        "invalid-value",
        `Rich-text ${name} value must use a px or em length${name === "size" ? " that is non-negative" : ""}.`,
        offset,
        length,
      )
      return false
    }
  }
  if (name === "shift") {
    const x = tag.attributes.x
    const y = tag.attributes.y
    if (
      (x === undefined && y === undefined) ||
      (x !== undefined && !parseLength(x, true)) ||
      (y !== undefined && !parseLength(y, true))
    ) {
      warning(
        warnings,
        "invalid-value",
        `Rich-text shift requires x or y to use a px or em length.`,
        offset,
        length,
      )
      return false
    }
  }
  if (name === "align" && !requireAttribute("value")) return false
  if (name === "align" && !alignmentValues.has(tag.attributes.value ?? "")) {
    warning(
      warnings,
      "invalid-value",
      `Rich-text align value must be left, center, right, or justify.`,
      offset,
      length,
    )
    return false
  }
  return true
}

interface OpenElement {
  readonly children: RichTextNode[]
  readonly node: RichTextElementNode
  readonly start: number
}

/**
 * Parses serialized card text without executing markup. Unknown tags and invalid tag syntax are
 * kept as literal text and reported in `warnings`. A recognized opening tag may remain open through
 * the end of the source: its formatting scope continues to the end and an `unclosed-tag` warning is
 * reported.
 */
export function parseRichText(source: string): RichTextParseResult {
  const warnings: RichTextWarning[] = []
  const roots: RichTextNode[] = []
  const stack: OpenElement[] = []
  let text = ""

  const currentChildren = () => stack.at(-1)?.children ?? roots
  const flushText = () => {
    appendText(currentChildren(), text)
    text = ""
  }
  const appendLiteral = (literal: string) => {
    text += literal
  }

  let index = 0
  while (index < source.length) {
    const character = source[index]
    if (character === "\\") {
      const escaped = source[index + 1]
      if (escaped === "<" || escaped === ">" || escaped === "\\" || escaped === '"') {
        text += escaped
        index += 2
      } else {
        text += character
        index += 1
      }
      continue
    }
    if (character !== "<") {
      text += character
      index += 1
      continue
    }

    const end = findTagEnd(source, index)
    if (end < 0) {
      warning(
        warnings,
        "malformed-tag",
        "Rich-text tag is missing its closing angle bracket.",
        index,
        source.length - index,
      )
      appendLiteral(source.slice(index))
      break
    }
    const length = end - index + 1
    const parsed = parseTag(source, index, end)
    if (!parsed) {
      warning(warnings, "malformed-tag", "Rich-text tag syntax is malformed.", index, length)
      appendLiteral(source.slice(index, end + 1))
      index = end + 1
      continue
    }
    if (!validateTag(parsed, warnings, index, length)) {
      appendLiteral(source.slice(index, end + 1))
      index = end + 1
      continue
    }

    flushText()
    const name = parsed.name
    if (parsed.closing) {
      const open = stack.at(-1)
      if (!open || open.node.tag !== name) {
        warning(
          warnings,
          "mismatched-closing-tag",
          `Rich-text closing tag </${name}> does not match the currently open tag.`,
          index,
          length,
        )
        appendLiteral(source.slice(index, end + 1))
      } else {
        stack.pop()
      }
    } else if (name === "space") {
      currentChildren().push({
        attributes: parsed.attributes,
        children: [],
        kind: "element",
        tag: name,
      })
    } else {
      const node: RichTextElementNode = {
        attributes: parsed.attributes,
        children: [],
        kind: "element",
        tag: name,
      }
      currentChildren().push(node)
      stack.push({ children: node.children as RichTextNode[], node, start: index })
    }
    index = end + 1
  }
  flushText()

  while (stack.length > 0) {
    const open = stack.pop()
    if (!open) continue
    warning(
      warnings,
      "unclosed-tag",
      `Rich-text tag <${open.node.tag}> is not closed.`,
      open.start,
      source.length - open.start,
    )
  }

  return {
    document: { children: roots, source },
    warnings,
  }
}

/** Returns the visible text, omitting formatting markup and representing explicit spaces as spaces. */
export function plainTextFromRichText(document: RichTextDocument): string {
  const visit = (nodes: readonly RichTextNode[]): string =>
    nodes
      .map((node) => {
        if (node.kind === "text") return node.text
        if (node.tag === "space") return " "
        return visit(node.children)
      })
      .join("")
  return visit(document.children)
}

/**
 * Returns whether a rich-text source has a visible leading authored line and visible content after
 * its first explicit newline. Rendered wrapping is deliberately irrelevant to this predicate.
 */
export function hasLeadingAuthoredLineFitSplit(source: string | RichTextDocument): boolean {
  const document = typeof source === "string" ? parseRichText(source).document : source
  const authoredLines = plainTextFromRichText(document).split(/\r\n?|\n/gu)
  return (
    authoredLines.length >= 2 &&
    /\S/u.test(authoredLines[0] ?? "") &&
    authoredLines.slice(1).some((line) => /\S/u.test(line))
  )
}

/** Splits text using the same grapheme boundary policy used by text measurement. */
export function graphemeSegments(text: string): readonly string[] {
  if (typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map(
      ({ segment }) => segment,
    )
  }
  return [...text]
}

export function graphemeCount(text: string) {
  return graphemeSegments(text).length
}

/** Returns the visible grapheme count for each rendered line of a rich-text source. */
export function richTextLineLengths(source: string): readonly number[] {
  const visibleText = plainTextFromRichText(parseRichText(source).document)
  return visibleText.split(/\r\n?|\n/gu).map(graphemeCount)
}

export function richTextHasFormatting(document: RichTextDocument) {
  return document.children.some((node) => node.kind === "element")
}

export function parseRichTextLength(value: string, allowNegative = false) {
  return parseLength(value, allowNegative)
}

export function parseRichTextScale(value: string) {
  return parseCompression(value)
}
