import type {
  CardData,
  CardSemanticBindings,
  CardSemantics,
  CardTemplate,
  SemanticBinding,
  SemanticCondition,
  SemanticPrimitive,
  SemanticSourceReference,
  SemanticTransform,
  SemanticValue,
  SemanticValueSource,
} from "./contracts/index.js"

function isSemanticPrimitive(value: unknown): value is SemanticPrimitive {
  return typeof value === "boolean" || typeof value === "number" || typeof value === "string"
}

function isSemanticPrimitiveList(value: unknown): value is readonly SemanticPrimitive[] {
  return Array.isArray(value) && value.every(isSemanticPrimitive)
}

function freezeValue(value: SemanticValue | undefined): SemanticValue | undefined {
  if (value !== undefined && !isSemanticPrimitive(value)) return Object.freeze(value.slice())
  return value
}

function sourceValue(
  card: CardData,
  source: SemanticValueSource,
  binding: SemanticBinding,
): SemanticValue | undefined {
  if ("value" in source) return freezeValue(source.value)
  const value = card[source.field]
  if (value === undefined || value === null || value === "") return undefined
  if (isSemanticPrimitive(value)) return value
  if (Array.isArray(value)) {
    const presentValues = value.filter((entry) => entry !== undefined)
    if (presentValues.length === 0) return undefined
    if (isSemanticPrimitiveList(presentValues)) {
      return freezeValue(presentValues)
    }
  }
  throw new Error(
    `Cannot derive semantic path "${binding.path}": field "${source.field}" must contain a scalar or a list of scalar values.`,
  )
}

function transformedValue(
  value: SemanticValue | undefined,
  transform: SemanticTransform | undefined,
  binding: SemanticBinding,
): SemanticValue | undefined {
  if (!transform) return value
  if (transform.kind === "unique-list") {
    if (value === undefined) return Object.freeze([])
    if (isSemanticPrimitive(value)) {
      throw new Error(
        `Cannot derive semantic path "${binding.path}": unique-list requires a list source.`,
      )
    }
    return Object.freeze([...new Set(value)])
  }
  if (transform.kind === "lookup") {
    if (value === undefined) return undefined
    if (!isSemanticPrimitive(value)) {
      throw new Error(
        `Cannot derive semantic path "${binding.path}": lookup requires a scalar source.`,
      )
    }
    return transform.values[String(value)]
  }
  if (value === undefined) return false
  if (isSemanticPrimitive(value)) {
    throw new Error(
      `Cannot derive semantic path "${binding.path}": includes requires a list source.`,
    )
  }
  return value.includes(transform.value)
}

function referencedValue(
  card: CardData,
  values: Readonly<Record<string, SemanticValue | undefined>>,
  source: SemanticSourceReference,
  binding: SemanticBinding,
) {
  if ("path" in source) return values[source.path]
  const value = card[source.field]
  if (value === undefined || value === null || value === "") return undefined
  if (isSemanticPrimitive(value)) return value
  if (isSemanticPrimitiveList(value)) {
    return value
  }
  throw new Error(
    `Cannot derive semantic path "${binding.path}": fallback field "${source.field}" must contain a scalar or a list of scalar values.`,
  )
}

function fallbackValue(
  card: CardData,
  values: Readonly<Record<string, SemanticValue | undefined>>,
  binding: SemanticBinding,
): SemanticValue | undefined {
  const fallback = binding.fallback
  if (!fallback) return undefined
  if (fallback.kind === "value") return fallback.value
  const source = referencedValue(card, values, fallback.source, binding)
  if (source === undefined) return fallback.minimum ?? 0
  if (!Array.isArray(source)) {
    throw new Error(
      `Cannot derive semantic path "${binding.path}": list-length fallback requires a list source.`,
    )
  }
  return Math.max(fallback.minimum ?? 0, source.length)
}

function shouldUseFallback(value: SemanticValue | undefined, binding: SemanticBinding) {
  return (
    value === undefined ||
    binding.fallbackValues?.some(
      (fallbackValue) => isSemanticPrimitive(value) && value === fallbackValue,
    ) === true
  )
}

function isActive(
  values: Readonly<Record<string, SemanticValue | undefined>>,
  binding: SemanticBinding,
) {
  return !binding.when || matchesSemanticCondition({ values }, binding.when)
}

/** Evaluates a template-declared semantic condition without knowing any card-family vocabulary. */
export function matchesSemanticCondition(
  semantics: CardSemantics,
  condition: SemanticCondition,
): boolean {
  if ("all" in condition) {
    return condition.all.every((child) => matchesSemanticCondition(semantics, child))
  }
  if ("any" in condition) {
    return condition.any.some((child) => matchesSemanticCondition(semantics, child))
  }
  if ("in" in condition) {
    const value = semantics.values[condition.path]
    return isSemanticPrimitive(value) && condition.in.includes(value)
  }
  return semantics.values[condition.path] === condition.equals
}

/**
 * Derives template-declared semantic values. This evaluator knows only the generic binding
 * operations declared in the template; it has no intrinsic card kinds, frames, or named positions.
 */
export function deriveCardSemantics(card: CardData, template: CardTemplate): CardSemantics {
  const bindings: CardSemanticBindings | undefined = template.semanticBindings
  if (!bindings) return Object.freeze({ values: Object.freeze({}) })

  const values: Record<string, SemanticValue | undefined> = {}
  bindings.bindings.forEach((binding) => {
    if (!isActive(values, binding)) {
      values[binding.path] = undefined
      return
    }
    let value = sourceValue(card, binding.source, binding)
    if (shouldUseFallback(value, binding)) value = fallbackValue(card, values, binding)
    values[binding.path] = freezeValue(transformedValue(value, binding.transform, binding))
  })
  return Object.freeze({ values: Object.freeze(values) })
}
