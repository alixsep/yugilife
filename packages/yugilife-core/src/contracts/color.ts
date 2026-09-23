import type { Region, SemanticAssetId } from "./template.js"

export interface IdentityColorPreset {
  method: "identity"
  metadata?: {
    target?: string
  }
}

export interface PolynomialColorPreset {
  method: "rgb-polynomial"
  exponents: readonly (readonly number[])[]
  coefficients: readonly (readonly number[])[]
  metadata?: {
    target?: string
  }
}

export interface HistogramColorPreset {
  method: "skimage-histogram-rgb-lut"
  channels: {
    r: readonly number[]
    g: readonly number[]
    b: readonly number[]
  }
  metadata?: {
    target?: string
  }
}

export type ColorPreset = IdentityColorPreset | PolynomialColorPreset | HistogramColorPreset
export type ColorPresetCollection = Readonly<Record<string, ColorPreset>>

/**
 * One gradeable texture: a source region of one semantic asset under one color preset. Grading is
 * the same pixel work for every card that resolves to the same triple, so it is worth doing once.
 */
export interface TexturePreparation {
  readonly assetId: SemanticAssetId
  readonly presetName: string
  /** Omitted when the layer grades the complete source image. */
  readonly region?: Region | undefined
}

/**
 * One prepared texture in a transferable, structured-clone-safe form.
 *
 * Color grading rewrites red, green and blue and never touches alpha, so a prepared texture is
 * stored as two fully opaque planes rather than one image with transparency: `color` carries the
 * graded channels and `alpha` the source coverage, replicated across its own color channels.
 * Lossless image codecs round-trip an opaque plane exactly, while a single RGBA image would have to
 * survive an unpremultiply/premultiply pair that is not exact at partially covered pixels.
 */
export interface PreparedTexturePayload {
  /** `preparedTextureKey` of the preparation this payload satisfies. */
  readonly key: string
  readonly width: number
  readonly height: number
  /** Lossless opaque image of the graded color channels. */
  readonly color: Blob
  /** Lossless opaque image of the source coverage; omitted when the region is fully opaque. */
  readonly alpha?: Blob | undefined
}

/**
 * Prepared textures by `preparedTextureKey`.
 *
 * A lookup, not a map, so a consumer can decode one texture the first time a render actually draws
 * it: a card shows a handful of the textures its template declares, and decoding the rest would
 * simply move the cost that grading used to have. Anything missing — never prepared, or a payload
 * that would not decode — resolves to undefined and is graded live, so this is never authoritative.
 */
export interface PreparedTextures {
  get(key: string): CanvasImageSource | PromiseLike<CanvasImageSource | undefined> | undefined
}
