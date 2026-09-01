import { describe, expect, it } from "vitest"

import { deriveCardSemantics, resolveCardPresentation } from "../src"
import { layerSourceFields } from "../src/rendering/layer-source-fields"

import { NAME_FIELD, testTemplate } from "./fixtures"

describe("rendered layer source fields", () => {
  it("finds direct fields and transitive semantic presentation dependencies", () => {
    const attributeLayer = {
      assetId: "attribute.dark",
      defaultVisible: false,
      id: "attributeDark",
      kind: "image" as const,
      region: { height: 10, width: 10, x: 0, y: 0 },
    }
    const template = testTemplate({
      cardFields: [
        NAME_FIELD,
        {
          kind: "text",
          label: "Attribute",
          name: "attribute",
          options: ["dark", "light"],
        },
      ],
      layers: [attributeLayer],
      presentationRules: [
        {
          id: "dark-attribute",
          layerVisibility: { attributeDark: true },
          when: { equals: "dark", path: "display.attribute" },
        },
      ],
      semanticBindings: {
        bindings: [
          { path: "attribute", source: { field: "attribute" } },
          {
            path: "display.attribute",
            source: { value: "dark" },
            when: { equals: "dark", path: "attribute" },
          },
        ],
      },
    })
    const card = { attribute: "dark", name: "Test" }
    const semantics = deriveCardSemantics(card, template)
    const presentation = resolveCardPresentation(template, semantics)

    expect(layerSourceFields(template, attributeLayer, presentation)).toEqual(["attribute"])
  })
})
