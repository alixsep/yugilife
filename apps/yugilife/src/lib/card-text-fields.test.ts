import { describe, expect, it } from "vitest"
import { deriveCardSemantics, resolveCardPresentation } from "yugilife-core"

import { createTextLayerFieldResolver } from "./card-text-fields"

import type { CardTemplate, TextLayer } from "yugilife-core"

describe("card text field mapping", () => {
  it("maps semantic-only SVG text back to its authored editor field", () => {
    const layer: TextLayer = {
      id: "attributeLabel",
      kind: "text",
      position: { x: 10, y: 20 },
      semanticPath: "attribute.label",
      typography: { fill: "#000", fontFamily: "sans-serif", fontSize: 10 },
    }
    const template: CardTemplate = {
      cardFields: [
        { kind: "text", label: "Name", name: "name", required: true },
        { kind: "text", label: "Attribute", name: "attribute" },
      ],
      dimensions: { height: 100, width: 100 },
      layers: [layer],
      schemaVersion: 1,
      semanticBindings: {
        bindings: [{ path: "attribute.label", source: { field: "attribute" } }],
      },
    }
    const semantics = deriveCardSemantics({ attribute: "DARK", name: "Test" }, template)
    const presentation = resolveCardPresentation(template, semantics)

    expect(createTextLayerFieldResolver(template, presentation)(layer)).toEqual(["attribute"])
  })
})
