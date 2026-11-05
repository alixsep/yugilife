// The page's own instance of the core, for the synchronous API. Importing yugilife-core waits for
// it once (top-level await); after that every synchronous function is a plain call.

import { TemplateValidationError } from "../errors"

import { CoreInstance } from "./instance"
import { coreModule } from "./module"

import type { CardData, CardSemantics, CardTemplate, LayerDefinition } from "../contracts/index.js"

const instance = await CoreInstance.create(await coreModule)

interface SyncResponse {
  readonly error?: { readonly kind: "range" | "render" | "validation"; readonly message: string }
  readonly value?: unknown
}

/** Runs one synchronous operation and throws the error class the TypeScript core threw. */
export function callSync<T>(operation: string, input: Readonly<Record<string, unknown>> = {}): T {
  const { response } = instance.call({ ...input, op: operation })
  const { error, value } = response as SyncResponse
  if (error) {
    if (error.kind === "validation") throw new TemplateValidationError(error.message)
    if (error.kind === "range") throw new RangeError(error.message)
    throw new Error(error.message)
  }
  return value as T
}

const keys = new WeakMap<object, string>()
const released = new FinalizationRegistry<string>((key) => callSync("release", { key }))
let nextKey = 1

function register(operation: "registerLayers" | "registerTemplate", value: object) {
  let key = keys.get(value)
  if (key === undefined) {
    key = `${operation === "registerTemplate" ? "template" : "layers"}:${nextKey++}`
    callSync(operation, { key, value })
    keys.set(value, key)
    released.register(value, key)
  }
  return key
}

/**
 * The core's key for a card template, registering it the first time. Keyed by object identity:
 * like the rest of the app's state, a template is replaced rather than changed in place.
 */
export function templateKey(template: CardTemplate) {
  return register("registerTemplate", template)
}

/** The core's key for a layer array, registering it the first time (by object identity). */
export function layersKey(layers: readonly LayerDefinition[]) {
  return register("registerLayers", layers)
}

/**
 * Card data for a synchronous call. Asset values (images) cannot be read synchronously, and
 * validation and semantics only need to know that one is there.
 */
export function cardInput(card: CardData) {
  return Object.fromEntries(
    Object.entries(card).map(([field, value]) => [
      field,
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? { $asset: true }
        : value,
    ]),
  )
}

/** JSON carries `undefined` as `null`; no semantic value is ever `null`. */
export function semanticsOutput(values: Readonly<Record<string, unknown>>): CardSemantics {
  return {
    values: Object.fromEntries(
      Object.entries(values).map(([path, value]) => [path, value === null ? undefined : value]),
    ) as CardSemantics["values"],
  }
}
