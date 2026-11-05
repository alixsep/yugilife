import { callSync, templateKey } from "./core/sync"

import type {
  CardFieldName,
  CardTemplate,
  LayerDefinition,
  ResolvedCardPresentation,
} from "./contracts/index.js"

/** The card fields an editor may focus for each layer of a rendered card. */
export function createLayerSourceFieldResolver(
  template: CardTemplate,
  presentation: ResolvedCardPresentation,
) {
  const key = templateKey(template)
  const known = new WeakMap<LayerDefinition, readonly CardFieldName[]>()
  return (layer: LayerDefinition): readonly CardFieldName[] => {
    let fields = known.get(layer)
    if (!fields) {
      fields = callSync<CardFieldName[]>("layerSourceFields", {
        layer,
        semantics: presentation.semantics,
        template: key,
        transforms: presentation.artworkTransforms,
      })
      known.set(layer, fields)
    }
    return fields
  }
}
