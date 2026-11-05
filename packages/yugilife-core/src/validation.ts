import { callSync, cardInput, templateKey } from "./core/sync"

import type {
  CardData,
  CardTemplate,
  ColorPresetCollection,
  PresentationOverrides,
  TemplateManifest,
} from "./contracts/index.js"

export { TemplateValidationError } from "./errors"

export function validateTemplateManifest(input: unknown): TemplateManifest {
  callSync("validateTemplateManifest", { input: input ?? null })
  return input as TemplateManifest
}

/** Validates an authored card template and returns its normalized form. */
export function validateCardTemplate(input: unknown): CardTemplate {
  return callSync("validateCardTemplate", { input: input ?? null })
}

export function validateColorPresetCollection(input: unknown): ColorPresetCollection {
  callSync("validateColorPresetCollection", { input: input ?? null })
  return input as ColorPresetCollection
}

export function validatePresentationOverrides(
  input: unknown,
  template: CardTemplate,
): PresentationOverrides {
  callSync("validatePresentationOverrides", {
    input: input ?? null,
    template: templateKey(template),
  })
  return input as PresentationOverrides
}

export function validateCardData(card: CardData, template: CardTemplate): void {
  callSync("validateCardData", { card: cardInput(card), template: templateKey(template) })
}

export function createCardFromTemplate(template: CardTemplate): CardData {
  return callSync("createCardFromTemplate", { template: templateKey(template) })
}
