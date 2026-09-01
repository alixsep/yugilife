import { matchesSemanticCondition } from "yugilife-core"

import type {
  CardFieldName,
  CardTemplate,
  ResolvedCardPresentation,
  SemanticCondition,
  SemanticPath,
  TextLayer,
} from "yugilife-core"

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

/** Maps rendered text layers to editor fields without adding editor metadata to core output. */
export function createTextLayerFieldResolver(
  template: CardTemplate,
  presentation: ResolvedCardPresentation,
) {
  const dependencies = semanticFieldDependencies(template)
  return (layer: TextLayer): readonly CardFieldName[] => {
    const fields = new Set<CardFieldName>()
    const addPath = (path: SemanticPath) =>
      dependencies.get(path)?.forEach((field) => fields.add(field))
    if (layer.field) fields.add(layer.field)
    if (layer.fallbackField) fields.add(layer.fallbackField)
    if (layer.semanticPath) addPath(layer.semanticPath)
    layer.semanticStyles
      ?.filter(({ when }) => matchesSemanticCondition(presentation.semantics, when))
      .flatMap(({ when }) => conditionPaths(when))
      .forEach(addPath)
    template.presentationRules
      ?.filter(
        (rule) =>
          matchesSemanticCondition(presentation.semantics, rule.when) &&
          (rule.layerVisibility?.[layer.id] !== undefined ||
            rule.textPositions?.[layer.id] !== undefined ||
            rule.textValues?.[layer.id] !== undefined),
      )
      .flatMap(({ when }) => conditionPaths(when))
      .forEach(addPath)
    return Object.freeze([...fields])
  }
}
