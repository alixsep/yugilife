import type { CardFieldDefinition, CardFieldName } from "./card.js"
import type { CanvasMask, SemanticPresentationRule } from "./presentation.js"
import type { CardSemanticBindings } from "./semantics.js"
import type { SemanticCondition, SemanticPath } from "./semantics.js"
import type { CardDimensions, Region, SemanticAssetId } from "./template.js"

export interface LayerBase {
  defaultVisible?: boolean | undefined
  /** Whether the layer appears in generated editor layer-visibility controls. */
  editorVisible?: boolean | undefined
  group?: string | undefined
  id: string
  kind: string
  label?: string | undefined
}

export interface ImageLayer extends LayerBase {
  kind: "image"
  assetId: SemanticAssetId
  region: Region
}

export interface RepeatedImageLayer extends LayerBase {
  kind: "repeated-image"
  assetId: SemanticAssetId
  field: CardFieldName
  offset: {
    x: number
    y: number
  }
  region: Region
}

export interface ArtworkLayer extends LayerBase {
  kind: "artwork"
  field: CardFieldName
  /** Defaults to stretching the source into the declared region. */
  fit?: "stretch" | "width" | undefined
  region: Region
}

export interface RasterLayer extends LayerBase {
  kind: "raster"
  renderer: string
  assetId?: SemanticAssetId
  defaultPreset?: string
  options?: Readonly<Record<string, unknown>>
  presetTarget?: string
  region: Region
  sourceRegion?: Region
}

export interface CanvasLayer extends LayerBase {
  kind: "canvas"
  renderer: string
  options?: Readonly<Record<string, unknown>>
  region: Region
}

export type TextFormat = "plain" | "lines" | "pair" | "type-list"

export interface TextFitProfile {
  fontSize: number
  id: string
  label: string
  lineHeight?: number | undefined
  /** Maximum horizontal compression derived automatically before trying the next profile. */
  maxAutoCompressionX?: number | undefined
  maxLines?: number | undefined
}

export type TextFitProfilePatch = Readonly<{
  [Key in Exclude<keyof TextFitProfile, "id">]?: undefined extends TextFitProfile[Key]
    ? TextFitProfile[Key] | null
    : TextFitProfile[Key]
}>

export interface TemplateTextDefaults {
  /** Default quantifier inherited by text layers that declare fit profiles. */
  autoScaleXQuantifier?: number | undefined
  /** Default automatic compression budget inherited by fitted text layers and profiles. */
  maxAutoCompressionX?: number | undefined
}

export interface LeadingAuthoredLineFitBlocks {
  split: "leading-authored-line"
  leading: {
    mode: "prefer-lines"
    preferredMaxLines: number
  }
  remainder: {
    mode: "layer-fit"
  }
}

export type TextFitBlocks = LeadingAuthoredLineFitBlocks

/** Expands inter-word spacing on non-final soft-wrapped multiline lines. */
export type TextAlign = "justify"

export interface TextTypography {
  /** Floors automatically derived horizontal scales to this positive increment. */
  autoScaleXQuantifier?: number | undefined
  fill: string
  fit?: "font-size" | "scale-x"
  fitBlocks?: TextFitBlocks | undefined
  /** Named template profile set expanded during template validation. */
  fitProfileSet?: string | undefined
  /** Sparse authoring-time or override patches applied to profiles by stable ID. */
  fitProfileOverrides?: Readonly<Record<string, TextFitProfilePatch | undefined>> | undefined
  fitProfiles?: readonly TextFitProfile[] | undefined
  fontAssetId?: SemanticAssetId
  fontFamily: string
  fontSize: number
  fontStyle?: "italic" | "normal"
  fontWeight?: string | number
  letterSpacing?: number
  lineHeight?: number
  /** Default automatic compression budget; an individual profile may override it. */
  maxAutoCompressionX?: number | undefined
  maxHeight?: number
  maxWidth?: number
  minFontSize?: number
  textAnchor?: "start" | "middle" | "end"
  textAlign?: TextAlign | undefined
  verticalAnchor?: "baseline" | "top"
  wrap?: "word"
}

/**
 * Sparse typography changes layered over a template default. `null` clears an optional inherited
 * property; required properties must always be supplied as concrete values.
 */
export type TextTypographyPatch = Readonly<{
  [Key in keyof TextTypography]?: undefined extends TextTypography[Key]
    ? TextTypography[Key] | null
    : TextTypography[Key]
}>

export interface SemanticTextStyle {
  id: string
  label: string
  typography?: TextTypographyPatch | undefined
  /** Named template typography patch applied before the style's inline typography. */
  typographyPreset?: string | undefined
  when: SemanticCondition
}

export interface TextLayer extends LayerBase {
  kind: "text"
  fallbackField?: CardFieldName
  /** Card source field; omitted when semanticPath supplies the complete value. */
  field?: CardFieldName
  format?: TextFormat
  /** Selects one entry when format is `pair`; useful for independent scale/stat slots. */
  pairIndex?: 0 | 1 | undefined
  position: {
    x: number
    y: number
  }
  /** Rich-text source fragment prepended to the serialized field or semantic value. */
  prefix?: string
  separator?: string
  /** Rich-text source fragment appended to the serialized field or semantic value. */
  suffix?: string
  semanticPath?: SemanticPath | undefined
  semanticStyles?: readonly SemanticTextStyle[] | undefined
  typography: TextTypography
}

export interface SvgElementDefinition {
  attributes?: Readonly<Record<string, string | number>>
  children?: readonly SvgElementDefinition[]
  tag: string
  text?: string
}

export interface SvgLayer extends LayerBase {
  kind: "svg"
  element: SvgElementDefinition
}

export interface GroupLayer extends LayerBase {
  kind: "group"
  layers: readonly LayerDefinition[]
}

export interface CustomLayer extends LayerBase {
  [property: string]: unknown
}

export type CoreLayerDefinition =
  | ImageLayer
  | RepeatedImageLayer
  | ArtworkLayer
  | RasterLayer
  | CanvasLayer
  | TextLayer
  | SvgLayer
  | GroupLayer

export type LayerDefinition = CoreLayerDefinition | CustomLayer

export interface CardTemplate {
  /**
   * Every card field this template understands, in author-facing order. A field is required when
   * `required` is true. Layers may only reference fields declared here.
   */
  cardFields: readonly CardFieldDefinition[]
  dimensions: CardDimensions
  /** Font-family to semantic asset ID mapping inherited by matching text typography. */
  fonts?: Readonly<Record<string, SemanticAssetId>> | undefined
  /** Named reusable fit-profile ladders expanded during validation. */
  fitProfileSets?: Readonly<Record<string, readonly TextFitProfile[]>> | undefined
  layers: readonly LayerDefinition[]
  /** Reusable full-card masks that may be assigned to raster-output layers or raster-only groups. */
  masks?: readonly CanvasMask[] | undefined
  /** Declarative semantic visibility and color-preset mappings resolved before rendering. */
  presentationRules?: readonly SemanticPresentationRule[] | undefined
  schemaVersion: number
  semanticBindings?: CardSemanticBindings | undefined
  /** Template-wide defaults inherited only by text layers with fit profiles. */
  textDefaults?: TemplateTextDefaults | undefined
  /** Named reusable typography patches for semantic text styles. */
  typographyPresets?: Readonly<Record<string, TextTypographyPatch>> | undefined
}

export type LayerVisibility = Readonly<Record<string, boolean | undefined>>

export interface LayerGroupEntry {
  id: string
  label: string
}

export interface LayerGroup {
  label: string
  layers: readonly LayerGroupEntry[]
}
