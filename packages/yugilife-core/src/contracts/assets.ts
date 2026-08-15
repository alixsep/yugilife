import type { SemanticAssetId } from "./template.js"

export type AssetSource =
  string | URL | Blob | HTMLImageElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas

export type AssetSourceMap = Readonly<Record<SemanticAssetId, AssetSource>>

export interface AssetResolver {
  has(id: SemanticAssetId): boolean
  resolve(id: SemanticAssetId): AssetSource
}
