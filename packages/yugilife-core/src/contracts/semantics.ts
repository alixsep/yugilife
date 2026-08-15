import type { CardFieldName } from "./card.js"

/** Values that may be compared or emitted by a declarative semantic binding. */
export type SemanticPrimitive = boolean | number | string

export type SemanticValue = SemanticPrimitive | readonly SemanticPrimitive[]

/** Semantic paths are template-declared identifiers, not a core-owned card taxonomy. */
export type SemanticPath = string

export type SemanticValueSource =
  { readonly field: CardFieldName } | { readonly value: SemanticValue }

export type SemanticSourceReference =
  { readonly field: CardFieldName } | { readonly path: SemanticPath }

/** Small, safe transformations that templates may request from a source value. */
export type SemanticTransform =
  | { readonly kind: "unique-list" }
  | { readonly kind: "includes"; readonly value: string }
  /** Declaratively remaps one scalar source value to another semantic value. */
  | {
      readonly kind: "lookup"
      readonly values: Readonly<Record<string, SemanticPrimitive>>
    }

/** Fallback derivations are generic operations; their meaning is not tied to a card family. */
export interface SemanticListLengthFallback {
  readonly kind: "list-length"
  readonly minimum?: number | undefined
  readonly source: SemanticSourceReference
}

export interface SemanticValueFallback {
  readonly kind: "value"
  readonly value: SemanticPrimitive
}

export type SemanticFallback = SemanticListLengthFallback | SemanticValueFallback

export interface SemanticBinding {
  /** Template-local semantic path produced by this binding. */
  readonly path: SemanticPath
  /** Card field or constant from which the value is read. */
  readonly source: SemanticValueSource
  /** Optional safe transformation of the source value. */
  readonly transform?: SemanticTransform | undefined
  /** Optional fallback when the source is absent or listed as a fallback value. */
  readonly fallback?: SemanticFallback | undefined
  readonly fallbackValues?: readonly SemanticPrimitive[] | undefined
  /** Binding activation is expressed using previously declared semantic paths. */
  readonly when?: SemanticCondition | undefined
}

export interface CardSemanticBindings {
  readonly bindings: readonly SemanticBinding[]
}

/** Generic semantic output. Its paths and values come entirely from the template. */
export interface CardSemantics {
  readonly values: Readonly<Record<SemanticPath, SemanticValue | undefined>>
}

export interface SemanticEqualsCondition {
  readonly equals: SemanticPrimitive
  readonly path: SemanticPath
}

/** A compact membership comparison for one scalar semantic value. */
export interface SemanticInCondition {
  readonly in: readonly SemanticPrimitive[]
  readonly path: SemanticPath
}

/** A conjunction keeps template presentation composable without adding executable expressions. */
export interface SemanticAllCondition {
  readonly all: readonly SemanticCondition[]
}

/** An alternative keeps a base presentation rule usable for unsupported modifier combinations. */
export interface SemanticAnyCondition {
  readonly any: readonly SemanticCondition[]
}

export type SemanticCondition =
  SemanticEqualsCondition | SemanticInCondition | SemanticAllCondition | SemanticAnyCondition
