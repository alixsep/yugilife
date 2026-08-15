import { describe, expect, it } from "vitest"

import {
  createCardFromTemplate,
  renderCard,
  validateCardData,
  validateCardTemplate,
  validateTemplateManifest,
} from "../src"
import { applyColorPreset } from "../src/public/color-grading"

import { NAME_FIELD, testTemplate, testTemplateBundle } from "./fixtures"

import type { TextLayer } from "../src"
import type { PixelImageData } from "../src/color-grading"
import type { PolynomialColorPreset } from "../src/contracts"

describe("generic template contracts", () => {
  it("accepts calendar template versions and rejects numeric or malformed versions", () => {
    const manifest = testTemplateBundle(testTemplate()).manifest

    expect(validateTemplateManifest(manifest).version).toBe("2026.01.01")
    expect(() => validateTemplateManifest({ ...manifest, version: "2026.01.01.10" })).not.toThrow()
    expect(() => validateTemplateManifest({ ...manifest, version: 52 })).toThrow(/YYYY\.MM\.DD/)
    expect(() => validateTemplateManifest({ ...manifest, version: "2026.02.29" })).toThrow(
      /YYYY\.MM\.DD/,
    )
    expect(() => validateTemplateManifest({ ...manifest, version: "2026.01.01.0" })).toThrow(
      /YYYY\.MM\.DD/,
    )
  })

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["future", 2],
  ])("rejects an unsupported %s template schema version", (_description, schemaVersion) => {
    expect(() => validateCardTemplate({ ...testTemplate(), schemaVersion })).toThrow(
      new RegExp(`Unsupported card template schemaVersion ${schemaVersion}.*current version is 1`),
    )
  })

  it("requires a template schema version", () => {
    const unversioned: Record<string, unknown> = { ...testTemplate() }
    delete unversioned["schemaVersion"]
    expect(() => validateCardTemplate(unversioned)).toThrow(/schemaVersion is required/)
  })

  it("accepts the supported template schema version", () => {
    expect(validateCardTemplate({ ...testTemplate(), schemaVersion: 1 }).schemaVersion).toBe(1)
  })

  it("validates semantic region selections in the current schema", () => {
    const regionSelection = {
      id: "region-selection",
      layerRegions: { marker: { height: 20, width: 20, x: 5, y: 6 } },
      when: { equals: "frame", path: "frame" },
    } as const
    const template = {
      ...testTemplate(),
      layers: [
        {
          assetId: "marker.asset",
          id: "marker",
          kind: "image",
          region: { height: 10, width: 10, x: 0, y: 0 },
        },
      ],
      presentationRules: [regionSelection],
      semanticBindings: {
        bindings: [{ path: "frame", source: { value: "frame" } }],
      },
    }

    expect(validateCardTemplate({ ...template, schemaVersion: 1 }).schemaVersion).toBe(1)
  })

  it("rejects obsolete card-specific keys instead of interpreting an older schema", () => {
    expect(() =>
      validateCardTemplate({
        ...testTemplate(),
        semanticBindings: { kind: "monster" },
      }),
    ).toThrow(/semanticBindings has unsupported fields: kind/)
  })

  it("allows a template to use one combined frame-and-border layer", () => {
    expect(
      validateCardTemplate(
        testTemplate({
          layers: [
            {
              id: "combined-frame",
              kind: "image",
              assetId: "custom.frame-and-border",
              region: { x: 0, y: 0, width: 100, height: 150 },
            },
          ],
        }),
      ).layers,
    ).toHaveLength(1)
  })

  it("rejects duplicate layer IDs across nested groups", () => {
    expect(() =>
      validateCardTemplate(
        testTemplate({
          layers: [
            {
              id: "duplicate",
              kind: "group",
              layers: [{ id: "duplicate", kind: "svg", element: { tag: "g" } }],
            },
          ],
        }),
      ),
    ).toThrow(/Duplicate layer ID "duplicate".*layers\[0\]\.layers\[0\]/)
  })

  it("enforces strict shared template-shape rules at runtime", () => {
    expect(() =>
      validateCardTemplate({
        ...testTemplate(),
        cardFields: [NAME_FIELD, NAME_FIELD],
      }),
    ).toThrow(/Duplicate card field "name"/)
    expect(() =>
      validateCardTemplate(
        testTemplate({
          layers: [
            {
              id: "name",
              kind: "text",
              field: "name",
              position: { x: 0, y: 0 },
              typography: {
                fill: "#000",
                fontFamily: "Test",
                fontSize: 20,
                maxWidth: -1,
              },
            },
          ],
        }),
      ),
    ).toThrow(/maxWidth must be positive/)
  })

  it("allows semantic-only text layers without inventing a card field", () => {
    const template = validateCardTemplate(
      testTemplate({
        semanticBindings: {
          bindings: [{ path: "label", source: { value: "SPELL CARD" } }],
        },
        layers: [
          {
            id: "label",
            kind: "text",
            semanticPath: "label",
            position: { x: 0, y: 20 },
            typography: { fill: "#000", fontFamily: "Test", fontSize: 20 },
          },
        ],
      }),
    )

    expect(template.layers[0]).toMatchObject({ id: "label", semanticPath: "label" })
    expect(() =>
      validateCardTemplate(
        testTemplate({
          layers: [
            {
              id: "missing-source",
              kind: "text",
              position: { x: 0, y: 20 },
              typography: { fill: "#000", fontFamily: "Test", fontSize: 20 },
            },
          ],
        }),
      ),
    ).toThrow(/must declare field or semanticPath/)
  })

  it("validates justified text as a word-wrapped multiline presentation", () => {
    expect(() =>
      validateCardTemplate(
        testTemplate({
          layers: [
            {
              id: "name",
              kind: "text",
              field: "name",
              position: { x: 0, y: 0 },
              typography: {
                fill: "#000",
                fontFamily: "Test",
                fontSize: 20,
                textAlign: "justify",
              },
            },
          ],
        }),
      ),
    ).toThrow(/textAlign "justify" requires multiline word wrapping/)

    expect(() =>
      validateCardTemplate(
        testTemplate({
          layers: [
            {
              id: "name",
              kind: "text",
              field: "name",
              position: { x: 0, y: 0 },
              typography: {
                fill: "#000",
                fontFamily: "Test",
                fontSize: 20,
                textAlign: "right",
              },
            },
          ],
        }),
      ),
    ).toThrow(/textAlign is unsupported/)
  })

  it("rejects a layer that references an undeclared card field", () => {
    expect(() =>
      validateCardTemplate(
        testTemplate({
          layers: [
            {
              id: "atk",
              kind: "text",
              field: "attack",
              position: { x: 0, y: 0 },
              typography: { fill: "#000", fontFamily: "Test", fontSize: 20 },
            },
          ],
        }),
      ),
    ).toThrow(/references card field "attack", which the template does not declare/)
  })

  it("rejects incompatible field kinds for core-provided layer renderers", () => {
    expect(() =>
      validateCardTemplate(
        testTemplate({
          layers: [
            {
              assetId: "star",
              field: "name",
              id: "stars",
              kind: "repeated-image",
              offset: { x: 1, y: 0 },
              region: { height: 1, width: 1, x: 0, y: 0 },
            },
          ],
        }),
      ),
    ).toThrow(/layers\[0\]\.field must reference a number field/)

    expect(() =>
      validateCardTemplate(
        testTemplate({
          layers: [
            {
              field: "name",
              id: "artwork",
              kind: "artwork",
              region: { height: 1, width: 1, x: 0, y: 0 },
            },
          ],
        }),
      ),
    ).toThrow(/layers\[0\]\.field must reference an image field/)
  })

  it("rejects incompatible semantic transform and fallback kinds", () => {
    expect(() =>
      validateCardTemplate(
        testTemplate({
          semanticBindings: {
            bindings: [
              {
                path: "bad.list",
                source: { field: "name" },
                transform: { kind: "unique-list" },
              },
            ],
          },
        }),
      ),
    ).toThrow(/unique-list.*requires a list source/)

    expect(() =>
      validateCardTemplate(
        testTemplate({
          cardFields: [NAME_FIELD, { kind: "text-list", label: "Tags", name: "tags" }],
          semanticBindings: {
            bindings: [
              {
                path: "bad.lookup",
                source: { field: "tags" },
                transform: { kind: "lookup", values: { a: "A" } },
              },
            ],
          },
        }),
      ),
    ).toThrow(/lookup.*requires a scalar source/)

    expect(() =>
      validateCardTemplate(
        testTemplate({
          semanticBindings: {
            bindings: [
              { path: "scalar", source: { field: "name" } },
              {
                fallback: { kind: "list-length", source: { path: "scalar" } },
                path: "bad.fallback",
                source: { field: "name" },
              },
            ],
          },
        }),
      ),
    ).toThrow(/fallback\.source must reference a list value/)
  })

  it("rejects unknown keys on core-provided layer definitions", () => {
    expect(() =>
      validateCardTemplate({
        ...testTemplate(),
        dimensions: { depth: 1, height: 150, width: 100 },
      }),
    ).toThrow(/dimensions has unsupported fields: depth/)

    expect(() =>
      validateCardTemplate(
        testTemplate({
          layers: [
            {
              assetId: "frame",
              id: "frame",
              kind: "image",
              opacity: 0.5,
              region: { height: 150, width: 100, x: 0, y: 0 },
            },
          ],
        }),
      ),
    ).toThrow(/layers\[0\] has unsupported fields: opacity/)

    expect(() =>
      validateCardTemplate(
        testTemplate({
          layers: [
            {
              field: "name",
              id: "name",
              kind: "text",
              position: { x: 0, y: 0 },
              typography: { fill: "#000", fontFamily: "Test", fontSize: 20, typo: true },
            },
          ],
        }),
      ),
    ).toThrow(/typography has unsupported fields: typo/)
  })

  it("validates repeated-image integer values before rendering", () => {
    const template = validateCardTemplate(
      testTemplate({
        cardFields: [NAME_FIELD, { kind: "number", label: "Count", name: "count" }],
        layers: [
          {
            assetId: "marker",
            field: "count",
            id: "markers",
            kind: "repeated-image",
            offset: { x: 1, y: 0 },
            region: { height: 1, width: 1, x: 0, y: 0 },
          },
        ],
      }),
    )

    expect(() => validateCardData({ count: 1.5, name: "Card" }, template)).toThrow(
      /"count" must be a non-negative integer/,
    )
  })

  it("requires a name field and rejects unsupported field metadata", () => {
    expect(() =>
      validateCardTemplate({
        ...testTemplate(),
        cardFields: [{ kind: "text", label: "Code", name: "cardCode" }],
      }),
    ).toThrow(/cardFields must declare the "name" field/)
    expect(() =>
      validateCardTemplate({
        ...testTemplate(),
        cardFields: [{ ...NAME_FIELD, options: ["A", "B"], defaultValue: "C" }],
      }),
    ).toThrow(/defaultValue must be one of: A, B/)
    expect(() =>
      validateCardTemplate({
        ...testTemplate(),
        cardFields: [NAME_FIELD, { kind: "text", label: "Level", name: "level", min: 1 }],
      }),
    ).toThrow(/may only use min and max on numeric fields/)
  })

  it("validates open text suggestions without constraining card values", () => {
    const template = validateCardTemplate({
      ...testTemplate(),
      cardFields: [
        {
          ...NAME_FIELD,
          suggestions: [
            { label: "1st Edition", value: "1<sup>st</sup> Edition" },
            { value: "Limited Edition" },
          ],
        },
      ],
    })

    expect(() => validateCardData({ name: "Custom Edition" }, template)).not.toThrow()
    expect(() =>
      validateCardTemplate({
        ...testTemplate(),
        cardFields: [
          { ...NAME_FIELD, suggestions: [{ value: "Duplicate" }, { value: "Duplicate" }] },
        ],
      }),
    ).toThrow(/duplicate value/)
    expect(() =>
      validateCardTemplate({
        ...testTemplate(),
        cardFields: [{ ...NAME_FIELD, options: ["A"], suggestions: [{ value: "B" }] }],
      }),
    ).toThrow(/cannot declare both options and suggestions/)
  })

  it("validates template-declared Automatic text-fit controls", () => {
    const fittedNameLayer = {
      field: "name",
      format: "lines" as const,
      id: "fittedName",
      kind: "text" as const,
      position: { x: 0, y: 0 },
      typography: {
        fill: "#000",
        fitProfiles: [{ fontSize: 20, id: "large", label: "Large", maxLines: 2 }],
        fontFamily: "Test",
        fontSize: 20,
        maxWidth: 100,
        wrap: "word" as const,
      },
    }

    expect(() =>
      validateCardTemplate({
        ...testTemplate({
          cardFields: [{ ...NAME_FIELD, automaticFitLayer: "missing" }],
          layers: [fittedNameLayer],
        }),
        schemaVersion: 1,
      }),
    ).toThrow(/automaticFitLayer references unknown text layer "missing"/)

    expect(
      validateCardTemplate({
        ...testTemplate({
          cardFields: [{ ...NAME_FIELD, automaticFitLayer: "fittedName" }],
          layers: [fittedNameLayer],
        }),
        schemaVersion: 1,
      }).cardFields[0]?.automaticFitLayer,
    ).toBe("fittedName")
  })

  it("validates quantified automatic compression and authored-line fit blocks", () => {
    const fittedLayer = {
      field: "name",
      format: "lines" as const,
      id: "fittedName",
      kind: "text" as const,
      position: { x: 0, y: 0 },
      typography: {
        autoScaleXQuantifier: 0.01,
        fill: "#000",
        fitBlocks: {
          leading: { mode: "prefer-lines" as const, preferredMaxLines: 1 },
          remainder: { mode: "layer-fit" as const },
          split: "leading-authored-line" as const,
        },
        fitProfiles: [
          {
            fontSize: 20,
            id: "large",
            label: "Large",
            maxAutoCompressionX: 0.2,
            maxLines: 2,
          },
        ],
        fontFamily: "Test",
        fontSize: 20,
        maxWidth: 100,
        wrap: "word" as const,
      },
    }

    expect(() =>
      validateCardTemplate({ ...testTemplate({ layers: [fittedLayer] }), schemaVersion: 1 }),
    ).not.toThrow()
    expect(() =>
      validateCardTemplate({
        ...testTemplate({
          layers: [
            {
              ...fittedLayer,
              typography: {
                ...fittedLayer.typography,
                fitProfiles: [
                  {
                    ...fittedLayer.typography.fitProfiles[0],
                    maxAutoCompressionX: 1,
                  },
                ],
              },
            },
          ],
        }),
        schemaVersion: 1,
      }),
    ).toThrow(/maxAutoCompressionX must be at least 0 and less than 1/)
    expect(() =>
      validateCardTemplate({
        ...testTemplate({
          layers: [
            {
              ...fittedLayer,
              typography: { ...fittedLayer.typography, autoScaleXQuantifier: 0 },
            },
          ],
        }),
        schemaVersion: 1,
      }),
    ).toThrow(/autoScaleXQuantifier must be positive/)
    expect(() =>
      validateCardTemplate({
        ...testTemplate({
          layers: [
            {
              ...fittedLayer,
              typography: {
                ...fittedLayer.typography,
                fitBlocks: {
                  ...fittedLayer.typography.fitBlocks,
                  remainder: { mode: "independent" },
                },
              },
            },
          ],
        }),
        schemaVersion: 1,
      }),
    ).toThrow(/fitBlocks\.remainder\.mode is unsupported/)
  })

  it("normalizes current-schema typography authoring defaults before presentation", () => {
    const authored = {
      ...testTemplate(),
      schemaVersion: 1,
      fonts: { Test: "font.test" },
      textDefaults: { autoScaleXQuantifier: 0.01, maxAutoCompressionX: 0.2 },
      fitProfileSets: {
        description: [
          { id: "large", label: "Large", fontSize: 20, lineHeight: 20, maxLines: 2 },
          { id: "small", label: "Small", fontSize: 16, lineHeight: 16, maxLines: 3 },
        ],
      },
      typographyPresets: { compact: { maxHeight: 40 } },
      semanticBindings: {
        bindings: [{ path: "variant", source: { value: "special" } }],
      },
      layers: [
        {
          field: "name",
          format: "lines",
          id: "fittedName",
          kind: "text",
          position: { x: 0, y: 0 },
          typography: {
            fill: "#000",
            fitProfileSet: "description",
            fitProfileOverrides: { large: { maxLines: 1 } },
            fontFamily: "Test",
            fontSize: 20,
            maxWidth: 100,
            wrap: "word",
          },
          semanticStyles: [
            {
              id: "compact",
              label: "Compact",
              typographyPreset: "compact",
              when: { path: "variant", in: ["special", "alternate"] },
            },
          ],
        },
      ],
    }
    const resolved = validateCardTemplate(authored)
    const layer = resolved.layers[0] as TextLayer
    expect(layer.typography).toMatchObject({
      autoScaleXQuantifier: 0.01,
      fontAssetId: "font.test",
      maxAutoCompressionX: 0.2,
    })
    expect(layer.typography.fitProfiles?.map(({ id, maxLines }) => [id, maxLines])).toEqual([
      ["large", 1],
      ["small", 3],
    ])
    expect(layer.semanticStyles?.[0]?.typography).toEqual({ maxHeight: 40 })
  })

  it("rejects unknown sparse profile overrides", () => {
    expect(() =>
      validateCardTemplate({
        ...testTemplate(),
        schemaVersion: 1,
        fitProfileSets: {
          one: [{ id: "large", label: "Large", fontSize: 20 }],
        },
        layers: [
          {
            field: "name",
            format: "lines",
            id: "fittedName",
            kind: "text",
            position: { x: 0, y: 0 },
            typography: {
              fill: "#000",
              fitProfileSet: "one",
              fitProfileOverrides: { missing: { maxLines: 1 } },
              fontFamily: "Test",
              fontSize: 20,
              maxWidth: 100,
              wrap: "word",
            },
          },
        ],
      }),
    ).toThrow(/references unknown profile "missing"/)
  })

  it("builds a starting card from declared field defaults", () => {
    const template = testTemplate({
      cardFields: [
        { ...NAME_FIELD, defaultValue: "Default name" },
        { kind: "number", label: "ATK", name: "attack", defaultValue: 2500 },
        { kind: "text-list", label: "Types", name: "types" },
        { kind: "number-pair", label: "Scales", name: "scales", min: 2 },
      ],
    })
    expect(createCardFromTemplate(template)).toStrictEqual({
      name: "Default name",
      attack: 2500,
      types: [],
      scales: [2, 2],
    })
  })

  it("validates card values against declared field constraints", () => {
    const template = testTemplate({
      cardFields: [
        NAME_FIELD,
        { kind: "number", label: "ATK", name: "attack", min: 0, max: 9999 },
        { kind: "text", label: "Attribute", name: "attribute", options: ["DARK", "LIGHT"] },
      ],
    })
    expect(() => validateCardData({ name: "" }, template)).toThrow(/"name" is required/)
    expect(() => validateCardData({ name: "Card", attack: 10_000 }, template)).toThrow(
      /"attack" must be at most 9999/,
    )
    expect(() => validateCardData({ name: "Card", attribute: "WATER" }, template)).toThrow(
      /"attribute" must be one of: DARK, LIGHT/,
    )
    expect(() =>
      validateCardData({ name: "Card", attack: 2500, attribute: "DARK" }, template),
    ).not.toThrow()
  })

  it.each([
    [
      "required",
      { kind: "text", label: "Required", name: "required", required: true },
      /cardFields\[1\] is required/,
    ],
    [
      "type",
      { defaultValue: "many", kind: "number", label: "Count", name: "count" },
      /defaultValue must be a finite number/,
    ],
    [
      "min",
      { defaultValue: 0, kind: "number", label: "Count", min: 1, name: "count" },
      /defaultValue must be at least 1/,
    ],
    [
      "max",
      { defaultValue: 2, kind: "number", label: "Count", max: 1, name: "count" },
      /defaultValue must be at most 1/,
    ],
    [
      "maxLength",
      { defaultValue: "long", kind: "text", label: "Code", maxLength: 3, name: "code" },
      /defaultValue must not exceed 3 characters/,
    ],
    [
      "maxItems",
      {
        defaultValue: ["a", "b"],
        kind: "text-list",
        label: "Types",
        maxItems: 1,
        name: "types",
      },
      /defaultValue must contain at most 1 entries/,
    ],
    [
      "allowed values",
      {
        defaultValue: "WATER",
        kind: "text",
        label: "Attribute",
        name: "attribute",
        options: ["DARK"],
      },
      /defaultValue must be one of: DARK/,
    ],
    [
      "image source",
      { defaultValue: 42, kind: "image", label: "Artwork", name: "artwork" },
      /defaultValue must be an image source/,
    ],
  ] as const)("rejects a template default that violates %s", (_constraint, field, message) => {
    expect(() => validateCardTemplate(testTemplate({ cardFields: [NAME_FIELD, field] }))).toThrow(
      message,
    )
  })

  it("guarantees a validated template creates immediately valid card data", () => {
    const template = validateCardTemplate(
      testTemplate({
        cardFields: [
          NAME_FIELD,
          { kind: "number", label: "Level", max: 12, min: 1, name: "level", required: true },
          {
            kind: "text",
            label: "Attribute",
            name: "attribute",
            options: ["DARK", "LIGHT"],
            required: true,
          },
          {
            defaultValue: "artwork.png",
            kind: "image",
            label: "Artwork",
            name: "artwork",
            required: true,
          },
        ],
      }),
    )
    const card = createCardFromTemplate(template)

    expect(card).toMatchObject({ artwork: "artwork.png", attribute: "DARK", level: 1 })
    expect(() => validateCardData(card, template)).not.toThrow()
  })

  it("validates runtime image fields as image sources", () => {
    const template = validateCardTemplate(
      testTemplate({
        cardFields: [
          NAME_FIELD,
          {
            defaultValue: "artwork.png",
            kind: "image",
            label: "Artwork",
            name: "artwork",
            required: true,
          },
        ],
      }),
    )

    expect(() => validateCardData({ artwork: 42, name: "Card" }, template)).toThrow(
      /"artwork" must be an image source/,
    )
    expect(() =>
      validateCardData({ artwork: new Blob(["image"]), name: "Card" }, template),
    ).not.toThrow()
  })

  it("enforces every constraint the field schema accepts", () => {
    const template = testTemplate({
      cardFields: [
        NAME_FIELD,
        { kind: "multiline", label: "Effect", name: "effect", maxItems: 2, maxLength: 8 },
        { kind: "text-list", label: "Types", name: "types", maxLength: 4 },
        { kind: "number-pair", label: "Scales", name: "scales", min: 0, max: 13 },
      ],
    })

    // maxItems on a multiline field, supplied as an array of lines and as one joined string.
    expect(() => validateCardData({ name: "C", effect: ["a", "b", "c"] }, template)).toThrow(
      /"effect" must contain at most 2 lines/,
    )
    expect(() => validateCardData({ name: "C", effect: "a\nb\nc" }, template)).toThrow(
      /"effect" must contain at most 2 lines/,
    )
    // maxLength on a multiline field applies per line, not to the joined text.
    expect(() => validateCardData({ name: "C", effect: "ok\nok" }, template)).not.toThrow()
    expect(() => validateCardData({ name: "C", effect: "far too long" }, template)).toThrow(
      /"effect" must not exceed 8 characters/,
    )
    // maxLength measures the visible projection, not serialized rich-text markup, even when a
    // formatting scope crosses an authored line break.
    expect(() =>
      validateCardData(
        {
          effect: '<color value="#ff0000">1234\n5678</color>',
          name: "C",
        },
        template,
      ),
    ).not.toThrow()
    expect(() =>
      validateCardData(
        {
          effect: '<color value="#ff0000">123456789</color>',
          name: "C",
        },
        template,
      ),
    ).toThrow(/"effect" must not exceed 8 characters/)
    // maxLength on a text-list field applies to each entry.
    expect(() => validateCardData({ name: "C", types: ["Dragon"] }, template)).toThrow(
      /"types" must not exceed 4 characters/,
    )
    expect(() => validateCardData({ name: "C", types: ["Rock"] }, template)).not.toThrow()
    expect(() =>
      validateCardData({ name: "C", types: ['<color value="#ff0000">Rock</color>'] }, template),
    ).not.toThrow()
    // min/max on a number-pair field applies to both entries.
    expect(() => validateCardData({ name: "C", scales: [0, 99] }, template)).toThrow(
      /"scales"\[1\] must be at most 13/,
    )
    expect(() => validateCardData({ name: "C", scales: [-1, 4] }, template)).toThrow(
      /"scales"\[0\] must be at least 0/,
    )
    expect(() => validateCardData({ name: "C", scales: [2, 9] }, template)).not.toThrow()
  })

  it("guarantees the name field matches the CardData contract", () => {
    expect(() =>
      validateCardTemplate({
        ...testTemplate(),
        cardFields: [{ kind: "number", label: "Name", name: "name", required: true }],
      }),
    ).toThrow(/"name" must use kind "text" or "multiline"/)
    expect(() =>
      validateCardTemplate({
        ...testTemplate(),
        cardFields: [{ kind: "text", label: "Name", name: "name" }],
      }),
    ).not.toThrow()
  })

  it("keeps generated numeric fallbacks inside declared bounds", () => {
    const card = createCardFromTemplate(
      testTemplate({
        cardFields: [
          NAME_FIELD,
          { kind: "number", label: "Level", name: "level", min: 3, max: 12 },
          { kind: "number-pair", label: "Scales", name: "scales", min: 2, max: 9 },
        ],
      }),
    )
    expect(card["level"]).toBe(3)
    expect(card["scales"]).toStrictEqual([2, 2])
  })

  it("fails before rendering unknown layers, unresolved assets, and missing fields", async () => {
    await expect(
      renderCard(
        { name: "Test" },
        {
          templateBundle: testTemplateBundle(
            testTemplate({ layers: [{ id: "custom", kind: "not-registered" }] }),
          ),
        },
      ),
    ).rejects.toThrow(/Unknown layer kind or renderer "not-registered".*Register a renderer/)

    await expect(
      renderCard(
        { name: "Test" },
        {
          templateBundle: testTemplateBundle(
            testTemplate({
              layers: [
                {
                  id: "combined",
                  kind: "image",
                  assetId: "missing.asset",
                  region: { x: 0, y: 0, width: 100, height: 150 },
                },
              ],
            }),
          ),
        },
      ),
    ).rejects.toThrow(/unresolved semantic asset ID "missing.asset"/)

    expect(() =>
      validateCardData(
        { name: "Test" },
        testTemplate({
          cardFields: [
            NAME_FIELD,
            { kind: "multiline", label: "Effect", name: "effect", required: true },
          ],
        }),
      ),
    ).toThrow(/"effect" is required/)
    expect(() =>
      validateCardTemplate({
        ...testTemplate(),
        dimensions: { width: 0, height: 150 },
      }),
    ).toThrow(/Malformed card template.*dimensions.width/)
  })

  it("does not resolve inherited object properties as renderers or assets", async () => {
    await expect(
      renderCard(
        { name: "Test" },
        {
          templateBundle: testTemplateBundle(
            testTemplate({ layers: [{ id: "polluted", kind: "toString" }] }),
          ),
        },
      ),
    ).rejects.toThrow(/Unknown layer kind or renderer "toString"/)

    await expect(
      renderCard(
        { name: "Test" },
        {
          templateBundle: testTemplateBundle(
            testTemplate({
              layers: [
                {
                  id: "polluted-asset",
                  kind: "image",
                  assetId: "toString",
                  region: { x: 0, y: 0, width: 100, height: 150 },
                },
              ],
            }),
          ),
        },
      ),
    ).rejects.toThrow(/unresolved semantic asset ID "toString"/)
  })
})

describe("applyColorPreset", () => {
  function applyPolynomialReference(imageData: PixelImageData, preset: PolynomialColorPreset) {
    const pixels = imageData.data
    for (let index = 0; index < pixels.length; index += 4) {
      const channels = [
        (pixels[index] ?? 0) / 255,
        (pixels[index + 1] ?? 0) / 255,
        (pixels[index + 2] ?? 0) / 255,
      ]
      const terms = preset.exponents.map((exponent) =>
        exponent.reduce((value, power, channel) => value * (channels[channel] ?? 0) ** power, 1),
      )
      for (let channel = 0; channel < 3; channel += 1) {
        let value = 0
        for (let term = 0; term < terms.length; term += 1) {
          value += (terms[term] ?? 0) * (preset.coefficients[term]?.[channel] ?? 0)
        }
        pixels[index + channel] = Math.max(0, Math.min(255, Math.round(value * 255)))
      }
    }
  }

  it("applies a polynomial preset without changing alpha", () => {
    const imageData = { data: new Uint8ClampedArray([100, 150, 200, 127]) }

    applyColorPreset(imageData, {
      method: "rgb-polynomial",
      exponents: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      coefficients: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    })

    expect([...imageData.data]).toEqual([100, 150, 200, 127])
  })

  it("keeps optimized canonical transforms byte-identical to the generic polynomial", () => {
    const source = new Uint8ClampedArray(256 * 4)
    for (let index = 0; index < 256; index += 1) {
      source[index * 4] = index
      source[index * 4 + 1] = (index * 73) % 256
      source[index * 4 + 2] = (index * 151) % 256
      source[index * 4 + 3] = (index * 37) % 256
    }

    const canonicalExponents = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [2, 0, 0],
      [1, 1, 0],
      [1, 0, 1],
      [0, 2, 0],
      [0, 1, 1],
      [0, 0, 2],
      [3, 0, 0],
      [2, 1, 0],
      [2, 0, 1],
      [1, 2, 0],
      [1, 1, 1],
      [1, 0, 2],
      [0, 3, 0],
      [0, 2, 1],
      [0, 1, 2],
      [0, 0, 3],
    ] as const
    const presets: PolynomialColorPreset[] = [4, 10, 20].map((termCount) => ({
      coefficients: Array.from({ length: termCount }, (_, term) => [
        ((term * 3) % 11) / 10 - 0.5,
        ((term * 5) % 13) / 10 - 0.6,
        ((term * 7) % 17) / 10 - 0.8,
      ]),
      exponents: canonicalExponents.slice(0, termCount),
      method: "rgb-polynomial",
    }))
    for (const preset of presets) {
      const expected = { data: source.slice() }
      const actual = { data: source.slice() }
      applyPolynomialReference(expected, preset)
      applyColorPreset(actual, preset)
      expect(actual.data).toEqual(expected.data)
    }
  })

  it("rejects malformed runtime color presets through the shared schema", () => {
    expect(() =>
      applyColorPreset(
        { data: new Uint8ClampedArray([0, 0, 0, 255]) },
        {
          method: "skimage-histogram-rgb-lut",
          channels: { r: [], g: [], b: [] },
        },
      ),
    ).toThrow(/must contain 256 values/)
    expect(() =>
      applyColorPreset(
        { data: new Uint8ClampedArray([0, 0, 0, 255]) },
        {
          method: "rgb-polynomial",
          exponents: [[0, 0, 0]],
          coefficients: [],
        },
      ),
    ).toThrow(/equally sized exponent and coefficient arrays/)
    expect(() =>
      applyColorPreset({ data: new Uint8ClampedArray([0, 0, 0, 255]) }, {
        method: "javascript",
      } as never),
    ).toThrow(/unsupported method "javascript"/)
  })
})
