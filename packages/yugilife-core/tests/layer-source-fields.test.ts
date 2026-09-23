import { describe, expect, it } from "vitest"

import { deriveCardSemantics, resolveCardPresentation } from "../src"
import { layerSourceFields } from "../src/rendering/layer-source-fields"

import { NAME_FIELD, testTemplate } from "./fixtures"

describe("rendered layer source fields", () => {
  it("finds direct fields and transitive semantic presentation dependencies", () => {
    const statusLayer = {
      assetId: "status.pending",
      defaultVisible: false,
      id: "pendingStatus",
      kind: "image" as const,
      region: { height: 10, width: 10, x: 0, y: 0 },
    }
    const template = testTemplate({
      cardFields: [
        NAME_FIELD,
        {
          kind: "text",
          label: "Status",
          name: "status",
          options: ["pending", "complete"],
        },
      ],
      layers: [statusLayer],
      presentationRules: [
        {
          id: "pending-status",
          layerVisibility: { pendingStatus: true },
          when: { equals: "pending", path: "display.status" },
        },
      ],
      semanticBindings: {
        bindings: [
          { path: "status", source: { field: "status" } },
          {
            path: "display.status",
            source: { value: "pending" },
            when: { equals: "pending", path: "status" },
          },
        ],
      },
    })
    const card = { name: "Test", status: "pending" }
    const semantics = deriveCardSemantics(card, template)
    const presentation = resolveCardPresentation(template, semantics)

    expect(layerSourceFields(template, statusLayer, presentation)).toEqual(["status"])
  })
})
