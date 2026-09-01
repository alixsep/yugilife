import type { RichTextWarning } from "../rich-text.js"
import type { AssetResolver, AssetSourceMap } from "./assets.js"
import type { CardData, CardFieldName } from "./card.js"
import type { ColorPresetCollection } from "./color.js"
import type {
  CardTemplate,
  LayerDefinition,
  LayerVisibility,
  SvgElementDefinition,
} from "./layers.js"
import type { PresentationOverrides, ResolvedCardPresentation } from "./presentation.js"
import type { Region, SemanticAssetId, TemplateManifest } from "./template.js"

export interface RenderLayerContext {
  assets: AssetResolver
  /** Resolved presentation asset source per layer; falls back to the layer's declared assetId. */
  assetSelections: Readonly<Record<string, SemanticAssetId>>
  card: CardData
  colorPresets: ColorPresetCollection
  context: CanvasRenderingContext2D
  /** Alpha-only recording target for the current raster layer; it never affects compositing. */
  coverageContext?: CanvasRenderingContext2D | undefined
  layerVisibility: LayerVisibility
  presetOverrides: Readonly<Record<string, string>>
  presentation: ResolvedCardPresentation
  /** Rich-text diagnostics collected while text layers are parsed for this render. */
  richTextWarnings: RichTextRenderWarning[]
  renderLayer(layer: LayerDefinition): Promise<void>
  signal?: AbortSignal | undefined
  template: CardTemplate
  /** Vector output for a renderer whose declared output is "vector". */
  vectorLayers: SvgElementDefinition[]
}

export type LayerRendererOutput = "container" | "raster" | "vector"

/**
 * Whether a renderer emitted output. Returning `false` suppresses an empty raster plane; returning
 * `true` or no value means the renderer emitted its declared output.
 */
export type LayerRendererResult = boolean | void

export interface LayerRenderer<TLayer extends LayerDefinition = LayerDefinition> {
  /**
   * The renderer's single compositing plane. A renderer may not emit both canvas and vector output;
   * split mixed output into separate ordered template layers.
   */
  output: LayerRendererOutput
  render(
    context: RenderLayerContext,
    layer: TLayer,
  ): Promise<LayerRendererResult> | LayerRendererResult
}

export type LayerRendererMap = Readonly<Record<string, LayerRenderer>>

export interface CardTemplateBundle {
  readonly assets: AssetSourceMap
  readonly colorPresets: ColorPresetCollection
  readonly manifest: TemplateManifest
  readonly template: CardTemplate
}

export interface RenderOptions {
  /** Complete template data and asset sources. Core never selects a template implicitly. */
  templateBundle: CardTemplateBundle
  /** Per-render semantic assets, merged over the template bundle (for example, card artwork). */
  assets?: Partial<AssetSourceMap> | undefined
  layerRenderers?: LayerRendererMap | undefined
  layers?: Partial<LayerVisibility> | undefined
  presetOverrides?: Readonly<Record<string, string>> | undefined
  presentationOverrides?: PresentationOverrides | undefined
  /**
   * Stops this render at the next async layer boundary. Shared image and font loads continue for
   * other consumers. The default abort reason is an AbortError; an explicit reason is propagated.
   */
  signal?: AbortSignal | undefined
}

export interface RasterRenderSegment {
  readonly canvas: HTMLCanvasElement
  readonly kind: "raster"
}

export interface VectorRenderSegment {
  readonly elements: readonly SvgElementDefinition[]
  readonly kind: "vector"
}

export type RenderSegment = RasterRenderSegment | VectorRenderSegment

export type RenderedElementAlphaKind = "image" | "svg"

/** Sampleable/exportable alpha coverage for one logical drawable layer. */
export interface RenderedElementAlphaChannel {
  /** Samples alpha coverage in native card coordinates, from 0 through 255. */
  alphaAt(x: number, y: number): number
  /** PNG for raster layers and SVG for vector layers. */
  toBlob(): Promise<Blob>
  readonly kind: RenderedElementAlphaKind
  readonly mimeType: "image/png" | "image/svg+xml"
}

export interface RenderedElementManifestEntry {
  /** This layer's resolved alpha after its own masks and clips, before higher-layer occlusion. */
  readonly absoluteAlpha: RenderedElementAlphaChannel
  /** Tight bounds of `absoluteAlpha`, independent of higher layers. */
  readonly absoluteBounds?: Region | undefined
  /** Final-visible alpha after every higher layer has been composited over this layer. */
  readonly alpha: RenderedElementAlphaChannel
  /** Tight native-card bounds containing every pixel with non-zero final alpha. */
  readonly bounds?: Region | undefined
  readonly layerId: string
  /** Original template order. Larger values are visually higher. */
  readonly order: number
  /** Card fields which an editor may focus for this rendered element. */
  readonly sourceFields: readonly CardFieldName[]
}

export interface RenderManifest {
  /** Drawable layers in original template order, including fully occluded layers. */
  readonly elements: readonly RenderedElementManifestEntry[]
}

export interface RenderedCard {
  /**
   * Contiguous compositing planes in exact template layer order. SVG export may flatten adjacent
   * raster planes into one PNG without changing this preview structure.
   */
  renderSegments: readonly RenderSegment[]
  /** Lazily replays coverage capture once and caches exact absolute and final-visible alpha. */
  createRenderManifest(): Promise<RenderManifest>
  /** Non-fatal rich-text diagnostics found while producing this card. */
  warnings: readonly RichTextRenderWarning[]
  presentation: ResolvedCardPresentation
  /** Encodes the complete ordered composition as a raster image. Defaults to native-size PNG. */
  toImage(options?: RasterExportOptions): Promise<Blob>
  template: CardTemplate
  /** Rasterizes the complete ordered composition to a PNG Blob at the requested scale. */
  toPng(options?: PngExportOptions): Promise<Blob>
  /** Returns ordered segments with live SVG text replaced by font outlines. */
  toOutlinedSegments(): Promise<readonly RenderSegment[]>
  /** Asynchronously serializes this render; defaults to portable outlined text paths. */
  toSvg(options?: SvgExportOptions): Promise<string>
  /** All vector elements in template order; use renderSegments when compositing. */
  vectorLayers: readonly SvgElementDefinition[]
}

export interface PngExportOptions {
  /** Output pixel multiplier. Defaults to 1 and must be finite and greater than zero. */
  scale?: number | undefined
}

export type PngCardExportOptions = RenderOptions & PngExportOptions

export type RasterImageFormat = "jpeg" | "png" | "webp"

export type RasterOutputSize =
  | { readonly height: number; readonly scale?: never; readonly width?: never }
  | { readonly height?: never; readonly scale: number; readonly width?: never }
  | { readonly height?: never; readonly scale?: never; readonly width: number }

export interface RasterExportOptions {
  /** Hex RGB matte used for JPEG transparency. Defaults to white and is invalid for other formats. */
  backgroundColor?: string | undefined
  /** Defaults to PNG. */
  format?: RasterImageFormat | undefined
  /** Lossy JPEG/WebP quality from 0 through 1. Defaults to 0.92. */
  quality?: number | undefined
  /** Preserves the template aspect ratio. Defaults to the template's native dimensions. */
  size?: RasterOutputSize | undefined
}

export type RasterCardExportOptions = RenderOptions & RasterExportOptions

export interface RichTextRenderWarning extends RichTextWarning {
  readonly layerId: string
}

export type SvgTextMode = "paths" | "text"

export interface SvgExportOptions {
  /** Defaults to grayscale antialiasing. */
  fontSmoothing?: "grayscale" | "subpixel" | undefined
  /**
   * `paths` makes exported text font-independent and is the default for `exportCardToSvg`.
   * `text` preserves selectable SVG text but requires the fonts wherever the SVG is viewed.
   */
  textMode?: SvgTextMode | undefined
  title?: string | undefined
}

export type SvgCardExportOptions = RenderOptions & SvgExportOptions
