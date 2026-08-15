export type RasterRenderFormat = "jpeg" | "png" | "webp"
export type RenderFormat = RasterRenderFormat | "svg"
export type SvgTextMode = "paths" | "text"

export interface SerializedRenderRequest {
  readonly card: Readonly<Record<string, unknown>>
  readonly files: Readonly<Record<string, string>>
  readonly format: RenderFormat
  readonly rasterOptions?: {
    readonly backgroundColor?: string
    readonly quality?: number
    readonly size?:
      { readonly height: number } | { readonly scale: number } | { readonly width: number }
  }
  readonly templateBundle: {
    readonly assets: Readonly<Record<string, string>>
    readonly colorPresets: unknown
    readonly manifest: unknown
    readonly template: unknown
  }
  readonly textMode?: SvgTextMode
  readonly title?: string
}

export interface SerializedRenderWarning {
  readonly code: string
  readonly layerId: string
  readonly length: number
  readonly message: string
  readonly offset: number
}

export interface BrowserRenderSuccess {
  readonly format: RenderFormat
  readonly ok: true
  /** SVG text for SVG output, or an image data URL for raster output. */
  readonly payload: string
  readonly warnings: readonly SerializedRenderWarning[]
}

export type BrowserErrorCode =
  "ABORTED" | "HARNESS_FAILED" | "RENDER_FAILED" | "RENDER_VALIDATION_FAILED"

export interface BrowserRenderFailure {
  readonly error: {
    readonly code: BrowserErrorCode
    readonly message: string
  }
  readonly ok: false
}

export type BrowserRenderResponse = BrowserRenderFailure | BrowserRenderSuccess

export interface BrowserSmokeResult {
  readonly dimensions: {
    readonly height: number
    readonly width: number
  }
  readonly ready: true
}

export interface BrowserApi {
  cancel(): void
  render(request: SerializedRenderRequest): Promise<BrowserRenderResponse>
  smoke(): Promise<BrowserSmokeResult>
}
