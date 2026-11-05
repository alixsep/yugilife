import { callSync, templateKey } from "./core/sync"

import type {
  ArtworkTransformOverrides,
  CardSemantics,
  CardTemplate,
  PresentationOverrides,
  ResolvedCardPresentation,
  ResolvedTextPresentation,
  SemanticCondition,
  TransformModeCondition,
} from "./contracts/index.js"

export function matchesPresentationGate(
  semantics: CardSemantics,
  transforms: ArtworkTransformOverrides,
  gate: {
    when?: SemanticCondition | undefined
    whenTransforms?: TransformModeCondition | undefined
  },
): boolean {
  return callSync("matchesPresentationGate", { gate, semantics, transforms })
}

type TextJson = Omit<ResolvedTextPresentation, "fitProfileId" | "value"> & {
  readonly fitProfileId: string | null
  readonly value: ResolvedTextPresentation["value"] | null
}

type PresentationJson = Omit<ResolvedCardPresentation, "semantics" | "text"> & {
  readonly text: Readonly<Record<string, TextJson>>
}

function frozenValues<T extends object>(record: Readonly<Record<string, T>>) {
  for (const value of Object.values(record)) Object.freeze(value)
  return Object.freeze(record)
}

/** Frozen like the TypeScript core's result; `semantics` is the caller's own object. */
export function resolveCardPresentation(
  template: CardTemplate,
  semantics: CardSemantics,
  overrides?: PresentationOverrides,
): ResolvedCardPresentation {
  const resolved = callSync<PresentationJson>("resolveCardPresentation", {
    overrides: overrides ?? null,
    semantics,
    template: templateKey(template),
  })
  const text: Record<string, ResolvedTextPresentation> = {}
  for (const [layerId, entry] of Object.entries(resolved.text)) {
    const { fitProfileId, value, ...rest } = entry
    text[layerId] = Object.freeze({
      ...rest,
      fitProfileId: fitProfileId ?? undefined,
      position: Object.freeze(rest.position),
      value: value ?? undefined,
    })
  }
  return Object.freeze({
    ...resolved,
    artworkTransforms: Object.freeze(resolved.artworkTransforms),
    assetSelections: Object.freeze(resolved.assetSelections),
    layerMasks: frozenValues(resolved.layerMasks),
    layerRegions: frozenValues(resolved.layerRegions),
    layerVisibility: Object.freeze(resolved.layerVisibility),
    presets: Object.freeze(resolved.presets),
    semantics,
    text: Object.freeze(text),
  })
}
