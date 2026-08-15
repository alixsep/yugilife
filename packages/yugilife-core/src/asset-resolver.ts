import type {
  AssetResolver,
  AssetSource,
  AssetSourceMap,
  SemanticAssetId,
} from "./contracts/index.js"

export class MapAssetResolver implements AssetResolver {
  readonly #assets = new Map<SemanticAssetId, AssetSource>()

  constructor(defaults: AssetSourceMap, overrides: Partial<AssetSourceMap> = {}) {
    for (const source of [defaults, overrides]) {
      for (const [id, value] of Object.entries(source)) {
        if (value !== undefined) this.#assets.set(id, value)
      }
    }
  }

  has(id: SemanticAssetId) {
    return this.#assets.has(id)
  }

  resolve(id: SemanticAssetId): AssetSource {
    const source = this.#assets.get(id)
    if (source === undefined) {
      throw new Error(
        `Unresolved semantic asset ID "${id}". Supply it through RenderOptions.assets.`,
      )
    }
    return source
  }
}
