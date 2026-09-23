import { matchesPresentationGate } from "../presentation.js"

import type {
  CardFieldName,
  CardTemplate,
  LayerDefinition,
  ResolvedCardPresentation,
  SemanticCondition,
  SemanticPath,
  TextLayer,
} from "../contracts/index.js"

function conditionPaths(condition: SemanticCondition): SemanticPath[] {
  if ("all" in condition) return condition.all.flatMap(conditionPaths)
  if ("any" in condition) return condition.any.flatMap(conditionPaths)
  return [condition.path]
}

function semanticFieldDependencies(template: CardTemplate) {
  const dependencies = new Map<SemanticPath, ReadonlySet<CardFieldName>>()
  for (const binding of template.semanticBindings?.bindings ?? []) {
    const fields = new Set<CardFieldName>()
    if ("field" in binding.source) fields.add(binding.source.field)
    for (const path of binding.when ? conditionPaths(binding.when) : []) {
      dependencies.get(path)?.forEach((field) => fields.add(field))
    }
    if (binding.fallback?.kind === "list-length") {
      if ("field" in binding.fallback.source) fields.add(binding.fallback.source.field)
      else dependencies.get(binding.fallback.source.path)?.forEach((field) => fields.add(field))
    }
    dependencies.set(binding.path, fields)
  }
  return dependencies
}

function ruleAffectsLayer(
  rule: NonNullable<CardTemplate["presentationRules"]>[number],
  layer: LayerDefinition,
) {
  return Boolean(
    rule.layerVisibility?.[layer.id] !== undefined ||
    rule.layerRegions?.[layer.id] ||
    rule.layerOptions?.[layer.id] ||
    rule.assetSelections?.[layer.id] ||
    rule.maskSelections?.[layer.id] ||
    rule.textValues?.[layer.id] !== undefined ||
    rule.textPositions?.[layer.id] ||
    ("presetTarget" in layer &&
      typeof layer.presetTarget === "string" &&
      rule.presets?.[layer.presetTarget] !== undefined),
  )
}

/** Creates a render-scoped resolver so semantic dependencies are derived only once per card. */
export function createLayerSourceFieldResolver(
  template: CardTemplate,
  presentation: ResolvedCardPresentation,
) {
  const dependencies = semanticFieldDependencies(template)
  return (layer: LayerDefinition) => {
    const fields = new Set<CardFieldName>()
    const addPath = (path: SemanticPath) =>
      dependencies.get(path)?.forEach((field) => fields.add(field))

    if ("field" in layer && typeof layer.field === "string") fields.add(layer.field)
    if ("maskField" in layer && typeof layer.maskField === "string") fields.add(layer.maskField)
    if ("fallbackField" in layer && typeof layer.fallbackField === "string") {
      fields.add(layer.fallbackField)
    }
    if ("semanticPath" in layer && typeof layer.semanticPath === "string") {
      addPath(layer.semanticPath)
    }
    // A transform-mode gate carries no authored card fields, but it still decides whether a style or
    // rule is active, so activity is tested through the shared matcher and only the semantic clause
    // contributes source fields.
    const isActive = (gate: Parameters<typeof matchesPresentationGate>[2]) =>
      matchesPresentationGate(presentation.semantics, presentation.artworkTransforms, gate)
    if (layer.kind === "text") {
      const textLayer = layer as TextLayer
      textLayer.semanticStyles
        ?.filter((style) => isActive(style))
        .flatMap(({ when }) => (when ? conditionPaths(when) : []))
        .forEach(addPath)
    }
    template.presentationRules
      ?.filter((rule) => ruleAffectsLayer(rule, layer) && isActive(rule))
      .flatMap(({ when }) => (when ? conditionPaths(when) : []))
      .forEach(addPath)
    return Object.freeze([...fields])
  }
}

/** Resolves the authored fields which caused one logical layer's current visible presentation. */
export function layerSourceFields(
  template: CardTemplate,
  layer: LayerDefinition,
  presentation: ResolvedCardPresentation,
) {
  return createLayerSourceFieldResolver(template, presentation)(layer)
}
