import type { AssetSource } from "./assets.js"
import type { SemanticCondition } from "./semantics.js"

export type CardFieldName = string

/** Serialized card text using the core rich-text syntax; plain strings remain valid sources. */
export type RichTextSource = string

export type CardFieldValue =
  | RichTextSource
  | number
  | boolean
  | AssetSource
  | readonly string[]
  | readonly (number | undefined)[]
  | undefined

export interface CardData {
  /** The field is always present in the in-memory contract, but an empty source is valid. */
  name: RichTextSource
  [field: CardFieldName]: CardFieldValue
}

/**
 * How one card field is authored and validated. Layer definitions reference fields by name; this
 * declares what a field means so that both validation and generated editors stay data-driven.
 */
export type CardFieldKind =
  "text" | "multiline" | "number" | "text-list" | "number-pair" | "boolean" | "image"

export type CardFieldDefaultValue =
  AssetSource | boolean | number | readonly string[] | readonly number[]

/** A common authored value offered by generated editors without constraining custom input. */
export interface CardFieldSuggestion {
  /** Human-readable choice text when the serialized rich-text value is not suitable for display. */
  label?: string | undefined
  /** Exact value written to CardData when the suggestion is chosen. */
  value: RichTextSource
}

export interface CardFieldDefinition {
  /** Text layer whose fit-profile selector is exposed beside this field in Automatic mode. */
  automaticFitLayer?: string | undefined
  /**
   * In Automatic mode, show this field when any declared semantic condition matches. Advanced mode
   * ignores this metadata so inactive template branches remain editable there.
   */
  automaticWhen?: SemanticCondition | readonly SemanticCondition[] | undefined
  /** Only show this field when the editor is in advanced mode. */
  advancedOnly?: boolean | undefined
  /** Initial value for a newly created card. */
  defaultValue?: CardFieldDefaultValue | undefined
  kind: CardFieldKind
  label: string
  /** Inclusive upper bound for a number field. */
  max?: number | undefined
  /** Maximum entry count for a text-list field. */
  maxItems?: number | undefined
  /** Maximum visible grapheme count per rendered line for a text, multiline, or text-list field. */
  maxLength?: number | undefined
  /** Inclusive lower bound for a number field. */
  min?: number | undefined
  name: CardFieldName
  /** Closed set of choices for text fields, or of each entry for text-list fields. */
  options?: readonly string[] | undefined
  /** Optional authored-value constraint; omitted fields accept an empty value of their declared kind. */
  required?: boolean | undefined
  /** Common values for a text field; unlike options, arbitrary authored values remain valid. */
  suggestions?: readonly CardFieldSuggestion[] | undefined
}
