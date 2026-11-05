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
