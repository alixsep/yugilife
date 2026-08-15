import type { RichTextSource } from "./card.js"
import type { TextTypography, TextTypographyPatch } from "./layers.js"
import type { CardSemantics, SemanticCondition, SemanticValue } from "./semantics.js"
import type { Region, SemanticAssetId } from "./template.js"

export type TextFitProfileOverrides = Readonly<
  Record<string, Readonly<Record<string, string | undefined>> | undefined>
>

export type TextTypographyOverrides = Readonly<
  Record<string, Readonly<Record<string, TextTypographyPatch | undefined>> | undefined>
>

/** Layer ID -> sparse renderer-option patch applied over the layer's declared options. */
export type LayerOptionsOverrides = Readonly<
  Record<string, Readonly<Record<string, unknown>> | undefined>
>

/** The source channel used to turn a mask image into canvas alpha coverage. */
export type CanvasMaskChannel = "alpha" | "luminance"

/** A template-owned, reusable full-card mask source. */
export interface CanvasMask {
  /** Stable template-local identity used by presentation rules and overrides. */
  readonly id: string
  /** Semantic asset containing the mask image, scaled to the template dimensions. */
  readonly assetId: SemanticAssetId
  /** Defaults to luminance so opaque black/white images behave as expected. */
  readonly channel?: CanvasMaskChannel | undefined
  /** Reverses the resulting coverage, so black can be the affected area. */
  readonly invert?: boolean | undefined
}

/** Layer or raster-only group ID -> template mask ID. `null` explicitly removes a resolved mask. */
export type LayerMaskOverrides = Readonly<Record<string, string | null | undefined>>

/** A resolved mask assignment ready for the raster compositor. */
export interface ResolvedLayerMask {
  readonly id: string
  readonly assetId: SemanticAssetId
  readonly channel: CanvasMaskChannel
  readonly invert: boolean
}

export interface TextPosition {
  readonly x: number
  readonly y: number
}

export interface PresentationOverrides {
  /** layer ID -> resolved semantic style ID -> sparse typography patch */
  readonly textTypography?: TextTypographyOverrides | undefined
  /** layer ID -> semantic style ID -> fit profile ID */
  readonly textFitProfiles?: TextFitProfileOverrides | undefined
  /** Layer or raster-only group ID -> template mask ID. */
  readonly layerMasks?: LayerMaskOverrides | undefined
}

export interface SemanticPresentationRule {
  /** Stable template-local identity used in ambiguity errors and diagnostics. */
  readonly id: string
  /** Layer IDs whose visibility changes when this rule matches. */
  readonly layerVisibility?: Readonly<Record<string, boolean>> | undefined
  /** Region selections applied to region-bearing layers when this rule matches. */
  readonly layerRegions?: Readonly<Record<string, Region>> | undefined
  /** Layer ID -> sparse renderer-option patches applied when this rule matches. */
  readonly layerOptions?: LayerOptionsOverrides | undefined
  /** Layer ID -> semantic asset ID mappings applied when this rule matches. */
  readonly assetSelections?: Readonly<Record<string, SemanticAssetId>> | undefined
  /** Layer or raster-only group ID -> template canvas-mask ID mappings applied when this rule matches. */
  readonly maskSelections?: Readonly<Record<string, string>> | undefined
  /** Raster preset target -> preset name mappings applied when this rule matches. */
  readonly presets?: Readonly<Record<string, string>> | undefined
  /** Text layer ID -> serialized rich-text source used when this rule matches. */
  readonly textValues?: Readonly<Record<string, RichTextSource>> | undefined
  /** Text layer ID -> position mappings applied when this rule matches. */
  readonly textPositions?: Readonly<Record<string, TextPosition>> | undefined
  readonly when: SemanticCondition
}

export interface ResolvedTextPresentation {
  readonly fitProfileId?: string | undefined
  readonly layerId: string
  readonly position: TextPosition
  readonly value?: SemanticValue | undefined
  readonly styleId: string
  readonly styleLabel: string
  readonly typography: TextTypography
}

export interface ResolvedCardPresentation {
  readonly assetSelections: Readonly<Record<string, SemanticAssetId>>
  readonly layerRegions: Readonly<Record<string, Region>>
  readonly layerMasks: Readonly<Record<string, ResolvedLayerMask>>
  readonly layerOptions: LayerOptionsOverrides
  readonly layerVisibility: Readonly<Record<string, boolean>>
  readonly semantics: CardSemantics
  readonly presets: Readonly<Record<string, string>>
  readonly text: Readonly<Record<string, ResolvedTextPresentation>>
}
