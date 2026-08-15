import { describe, expect, it } from "vitest"

import { deriveCardSemantics, resolveCardPresentation, validateCardTemplate } from "../src"

import { NAME_FIELD, testTemplate } from "./fixtures"

const effectTypography = {
  fill: "#000",
  fitProfiles: [
    { fontSize: 30, id: "large", label: "Large", maxLines: 4 },
    { fontSize: 20, id: "small", label: "Small", maxLines: 8 },
  ],
  fontFamily: "Effect",
  fontSize: 30,
  maxWidth: 100,
  wrap: "word" as const,
}

const loreTypography = {
  fill: "#000",
  fitProfiles: [
    { fontSize: 28, id: "large", label: "Large", maxLines: 2 },
    { fontSize: 25, id: "small", label: "Small", maxLines: 4 },
  ],
  fontFamily: "Lore",
  fontSize: 28,
  maxWidth: 100,
  wrap: "word" as const,
}

function semanticTemplate() {
  return validateCardTemplate(
    testTemplate({
      cardFields: [
        NAME_FIELD,
        {
          defaultValue: "effect",
          kind: "text",
          label: "Monster frame",
          name: "monsterFrame",
          options: ["normal", "effect"],
          required: true,
        },
        { kind: "multiline", label: "Description", name: "description" },
      ],
      semanticBindings: {
        bindings: [
          { path: "kind", source: { value: "monster" } },
          { path: "monster.frame", source: { field: "monsterFrame" } },
        ],
      },
      layers: [
        {
          field: "description",
          format: "lines",
          id: "description",
          kind: "text",
          position: { x: 0, y: 20 },
          semanticStyles: [
            {
              id: "lore",
              label: "Lore text",
              typography: {
                fitProfiles: loreTypography.fitProfiles,
                fontFamily: loreTypography.fontFamily,
                fontSize: loreTypography.fontSize,
                maxWidth: loreTypography.maxWidth,
              },
              when: { equals: "normal", path: "monster.frame" },
            },
          ],
          typography: effectTypography,
        },
      ],
    }),
  )
}

describe("card semantics and presentation", () => {
  it("derives monster meaning from validated semantic bindings, not display text", () => {
    const template = semanticTemplate()

    expect(
      deriveCardSemantics(
        { description: "Lore", monsterFrame: "normal", name: "Card", types: ["Effect"] },
        template,
      ),
    ).toStrictEqual({
      values: {
        kind: "monster",
        "monster.frame": "normal",
      },
    })
  })

  it("accepts semantic values introduced only by the template", () => {
    const template = validateCardTemplate(
      testTemplate({
        cardFields: [
          NAME_FIELD,
          {
            defaultValue: "future-frame",
            kind: "text",
            label: "Template variant",
            name: "variant",
            options: ["synchro", "future-frame"],
            required: true,
          },
        ],
        semanticBindings: {
          bindings: [{ path: "card.variant", source: { field: "variant" } }],
        },
      }),
    )

    expect(deriveCardSemantics({ name: "Card", variant: "future-frame" }, template)).toStrictEqual({
      values: { "card.variant": "future-frame" },
    })
  })

  it("supports template-declared scalar lookup transforms", () => {
    const template = validateCardTemplate(
      testTemplate({
        cardFields: [
          NAME_FIELD,
          {
            defaultValue: "effect",
            kind: "text",
            label: "Card variant",
            name: "variant",
            options: ["effect", "spell"],
            required: true,
          },
        ],
        semanticBindings: {
          bindings: [
            {
              path: "kind",
              source: { field: "variant" },
              transform: {
                kind: "lookup",
                values: { effect: "monster", spell: "spell" },
              },
            },
          ],
        },
      }),
    )

    expect(deriveCardSemantics({ name: "Card", variant: "spell" }, template)).toStrictEqual({
      values: { kind: "spell" },
    })
  })

  it("maps semantics to a template style before applying per-style overrides", () => {
    const template = semanticTemplate()
    const overrides = {
      textTypography: {
        description: {
          lore: { fill: "#f00" },
        },
      },
      textFitProfiles: {
        description: { default: "large", lore: "small" },
      },
    }
    const normal = deriveCardSemantics({ monsterFrame: "normal", name: "Card" }, template)
    const effect = deriveCardSemantics({ monsterFrame: "effect", name: "Card" }, template)

    expect(resolveCardPresentation(template, normal, overrides).text["description"]).toMatchObject({
      fitProfileId: "small",
      styleId: "lore",
      styleLabel: "Lore text",
      typography: { fill: "#f00", fontFamily: "Lore" },
    })
    expect(resolveCardPresentation(template, effect, overrides).text["description"]).toMatchObject({
      fitProfileId: "large",
      styleId: "default",
      styleLabel: "description",
      typography: { fill: "#000", fontFamily: "Effect" },
    })
  })

  it("inherits default typography fields through partial semantic styles", () => {
    const template = semanticTemplate()
    const normal = deriveCardSemantics({ monsterFrame: "normal", name: "Card" }, template)

    expect(resolveCardPresentation(template, normal).text["description"]?.typography).toMatchObject(
      {
        fill: "#000",
        fontFamily: "Lore",
        wrap: "word",
      },
    )
  })

  it("allows a semantic patch to clear an optional default property", () => {
    const template = validateCardTemplate(
      testTemplate({
        cardFields: [NAME_FIELD, { kind: "text", label: "Frame", name: "frame" }],
        semanticBindings: {
          bindings: [{ path: "frame", source: { field: "frame" } }],
        },
        layers: [
          {
            field: "name",
            format: "plain",
            id: "name",
            kind: "text",
            position: { x: 0, y: 20 },
            semanticStyles: [
              {
                id: "plain",
                label: "Plain",
                typography: { textAnchor: null },
                when: { equals: "plain", path: "frame" },
              },
            ],
            typography: {
              fill: "#000",
              fontFamily: "Test",
              fontSize: 20,
              textAnchor: "end",
            },
          },
        ],
      }),
    )

    const semantics = deriveCardSemantics({ frame: "plain", name: "Card" }, template)
    expect(resolveCardPresentation(template, semantics).text.name?.typography).not.toHaveProperty(
      "textAnchor",
    )
  })

  it("lets editor typography patches override semantic patches", () => {
    const template = semanticTemplate()
    const normal = deriveCardSemantics({ monsterFrame: "normal", name: "Card" }, template)

    expect(
      resolveCardPresentation(template, normal, {
        textTypography: { description: { lore: { fill: "#0f0", fontSize: 18 } } },
      }).text.description?.typography,
    ).toMatchObject({
      fill: "#0f0",
      fontFamily: "Lore",
      fontSize: 18,
    })
  })

  it("validates persisted presentation overrides before resolving them", () => {
    const template = semanticTemplate()
    const semantics = deriveCardSemantics({ monsterFrame: "effect", name: "Card" }, template)

    expect(() =>
      resolveCardPresentation(template, semantics, {
        textTypography: { description: { default: { fill: null } } },
      } as never),
    ).toThrow(/textTypography\.description\.default\.fill must be a non-empty string/)

    expect(() =>
      resolveCardPresentation(template, semantics, {
        textTypography: { missing: { default: { fill: "#fff" } } },
      }),
    ).toThrow(/textTypography references unknown text layer "missing"/)

    expect(() =>
      resolveCardPresentation(template, semantics, {
        textFitProfiles: { description: { default: "missing" } },
      }),
    ).toThrow(/references unknown fit profile "missing"/)

    expect(() =>
      resolveCardPresentation(template, semantics, { unexpected: true } as never),
    ).toThrow(/Presentation overrides has unsupported fields: unexpected/)
  })

  it("validates persisted mask overrides against template-owned layers and masks", () => {
    const template = validateCardTemplate(
      testTemplate({
        schemaVersion: 1,
        masks: [{ assetId: "mask", id: "shape" }],
        layers: [
          {
            id: "paint",
            kind: "raster",
            region: { height: 10, width: 10, x: 0, y: 0 },
            renderer: "gradient",
          },
          {
            field: "name",
            id: "label",
            kind: "text",
            position: { x: 0, y: 20 },
            typography: { fill: "#000", fontFamily: "Test", fontSize: 20 },
          },
        ],
      }),
    )
    const semantics = deriveCardSemantics({ name: "Card" }, template)

    expect(() =>
      resolveCardPresentation(template, semantics, { layerMasks: { missing: "shape" } }),
    ).toThrow(/layerMasks references unknown layer "missing"/)
    expect(() =>
      resolveCardPresentation(template, semantics, { layerMasks: { label: "shape" } }),
    ).toThrow(/cannot assign a mask to non-raster layer "label"/)
    expect(() =>
      resolveCardPresentation(template, semantics, { layerMasks: { paint: "missing" } }),
    ).toThrow(/references unknown mask "missing"/)
    expect(
      resolveCardPresentation(template, semantics, { layerMasks: { paint: "shape" } }).layerMasks,
    ).toHaveProperty("paint.id", "shape")
  })

  it("rejects an empty semantic typography patch", () => {
    expect(() =>
      validateCardTemplate(
        testTemplate({
          cardFields: [NAME_FIELD, { kind: "text", label: "Frame", name: "frame" }],
          semanticBindings: {
            bindings: [{ path: "frame", source: { field: "frame" } }],
          },
          layers: [
            {
              field: "name",
              id: "name",
              kind: "text",
              position: { x: 0, y: 20 },
              semanticStyles: [
                {
                  id: "plain",
                  label: "Plain",
                  typography: {},
                  when: { equals: "plain", path: "frame" },
                },
              ],
              typography: { fill: "#000", fontFamily: "Test", fontSize: 20 },
            },
          ],
        }),
      ),
    ).toThrow(/must declare at least one typography override/)
  })

  it("requires semantic conditions to reference template-declared paths", () => {
    expect(() =>
      validateCardTemplate(
        testTemplate({
          presentationRules: [
            {
              id: "unknown-path",
              layerVisibility: { missing: true },
              when: { equals: "anything", path: "missing.path" },
            },
          ],
          semanticBindings: {
            bindings: [{ path: "kind", source: { value: "anything" } }],
          },
        }),
      ),
    ).toThrow(/must reference a declared semantic binding/)
  })
})
