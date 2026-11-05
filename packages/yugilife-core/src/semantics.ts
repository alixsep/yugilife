import { callSync, cardInput, semanticsOutput, templateKey } from "./core/sync"

import type { CardData, CardSemantics, CardTemplate, SemanticCondition } from "./contracts/index.js"

export function deriveCardSemantics(card: CardData, template: CardTemplate): CardSemantics {
  const { values } = callSync<{ values: Record<string, unknown> }>("deriveCardSemantics", {
    card: cardInput(card),
    template: templateKey(template),
  })
  return semanticsOutput(values)
}

export function matchesSemanticCondition(
  semantics: CardSemantics,
  condition: SemanticCondition,
): boolean {
  return callSync("matchesSemanticCondition", { condition, semantics })
}
