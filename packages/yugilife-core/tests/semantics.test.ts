import { describe, expect, it } from "vitest"

import { deriveCardSemantics, resolveCardPresentation, validateCardTemplate } from "../src"

import { NAME_FIELD, testTemplate } from "./fixtures"

const bodyTypography = {
  fill: "#000",
  fitProfiles: [
    { fontSize: 30, id: "large", label: "Large", maxLines: 4 },
    { fontSize: 20, id: "small", label: "Small", maxLines: 8 },
  ],
  fontFamily: "Body",
  fontSize: 30,
  maxWidth: 100,
  wrap: "word" as const,
}

const annotationTypography = {
  fill: "#000",
  fitProfiles: [
    { fontSize: 28, id: "large", label: "Large", maxLines: 2 },
    { fontSize: 25, id: "small", label: "Small", maxLines: 4 },
  ],
  fontFamily: "Annotation",
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
          defaultValue: "plain",
          kind: "text",
          label: "Layout variant",
          name: "layoutVariant",
          options: ["annotated", "plain"],
          required: true,
        },
        { kind: "multiline", label: "Description", name: "description" },
      ],
      semanticBindings: {
        bindings: [
          { path: "kind", source: { value: "document" } },
          { path: "document.layout", source: { field: "layoutVariant" } },
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
              id: "annotation",
              label: "Annotation text",
              typography: {
                fitProfiles: annotationTypography.fitProfiles,
                fontFamily: annotationTypography.fontFamily,
                fontSize: annotationTypography.fontSize,
                maxWidth: annotationTypography.maxWidth,
              },
              when: { equals: "annotated", path: "document.layout" },
            },
          ],
          typography: bodyTypography,
        },
      ],
    }),
  )
}

describe("card semantics and presentation", () => {
  it("derives template-owned meaning from bindings rather than display text", () => {
    const template = semanticTemplate()

    expect(
      deriveCardSemantics(
        { description: "Note", layoutVariant: "annotated", name: "Document" },
        template,
      ),
    ).toStrictEqual({
      values: {
        kind: "document",
        "document.layout": "annotated",
      },
    })
  })

  it("accepts semantic values introduced only by the template", () => {
    const template = validateCardTemplate(
      testTemplate({
        cardFields: [
          NAME_FIELD,
          {
            defaultValue: "future-layout",
            kind: "text",
            label: "Template variant",
            name: "variant",
            options: ["legacy-layout", "future-layout"],
            required: true,
          },
        ],
        semanticBindings: {
          bindings: [{ path: "card.variant", source: { field: "variant" } }],
        },
      }),
    )

    expect(
      deriveCardSemantics({ name: "Document", variant: "future-layout" }, template),
    ).toStrictEqual({
      values: { "card.variant": "future-layout" },
    })
  })

  it("supports template-declared scalar lookup transforms", () => {
    const template = validateCardTemplate(
      testTemplate({
        cardFields: [
          NAME_FIELD,
          {
            defaultValue: "print",
            kind: "text",
            label: "Card variant",
            name: "variant",
            options: ["print", "screen"],
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
                values: { print: "static", screen: "interactive" },
              },
            },
          ],
        },
      }),
    )

    expect(deriveCardSemantics({ name: "Document", variant: "screen" }, template)).toStrictEqual({
      values: { kind: "interactive" },
    })
  })

  it("maps semantics to a template style before applying per-style overrides", () => {
    const template = semanticTemplate()
    const overrides = {
      textTypography: {
        description: {
          annotation: { fill: "#f00" },
        },
      },
      textFitProfiles: {
        description: { annotation: "small", default: "large" },
      },
    }
    const annotated = deriveCardSemantics(
      { layoutVariant: "annotated", name: "Document" },
      template,
    )
    const plain = deriveCardSemantics({ layoutVariant: "plain", name: "Document" }, template)

    expect(
      resolveCardPresentation(template, annotated, overrides).text["description"],
    ).toMatchObject({
      fitProfileId: "small",
      styleId: "annotation",
      styleLabel: "Annotation text",
      typography: { fill: "#f00", fontFamily: "Annotation" },
    })
    expect(resolveCardPresentation(template, plain, overrides).text["description"]).toMatchObject({
      fitProfileId: "large",
      styleId: "default",
      styleLabel: "description",
      typography: { fill: "#000", fontFamily: "Body" },
    })
  })

  it("inherits default typography fields through partial semantic styles", () => {
    const template = semanticTemplate()
    const annotated = deriveCardSemantics(
      { layoutVariant: "annotated", name: "Document" },
      template,
    )

    expect(
      resolveCardPresentation(template, annotated).text["description"]?.typography,
    ).toMatchObject({
      fill: "#000",
      fontFamily: "Annotation",
      wrap: "word",
    })
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
    const annotated = deriveCardSemantics(
      { layoutVariant: "annotated", name: "Document" },
      template,
    )

    expect(
      resolveCardPresentation(template, annotated, {
        textTypography: { description: { annotation: { fill: "#0f0", fontSize: 18 } } },
      }).text.description?.typography,
    ).toMatchObject({
      fill: "#0f0",
      fontFamily: "Annotation",
      fontSize: 18,
    })
  })

  it("validates persisted presentation overrides before resolving them", () => {
    const template = semanticTemplate()
    const semantics = deriveCardSemantics({ layoutVariant: "plain", name: "Document" }, template)

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
