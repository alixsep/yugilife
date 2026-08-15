import { describe, expect, it } from "vitest"
import { deriveCardSemantics, flattenDrawableLayers, resolveCardPresentation } from "yugilife-core"

import { DEFAULT_TEMPLATE } from "../src"

describe("Series 10 semantics and presentation", () => {
  it("maps every supported Series 10 monster variant to its declared preset and frame layers", () => {
    const official = DEFAULT_TEMPLATE
    const variantField = official.template.cardFields.find((field) => field.name === "cardVariant")
    expect(variantField?.options).toEqual([
      "normal",
      "effect",
      "ritual",
      "fusion",
      "synchro",
      "xyz",
      "link",
      "token",
      "token-with-stats",
      "spell",
      "trap",
    ])
    expect(variantField).toMatchObject({ defaultValue: "effect", required: true })

    const expected = {
      effect: {
        presets: { "effect-box": "effect-box-s10" },
        layerVisibility: {
          atk: true,
          atkLabel: true,
          def: true,
          defLabel: true,
          frameTexture: true,
          levelStar: true,
          link: false,
          linkFrame: false,
          rankStar: false,
          statsSeparator: true,
        },
      },
      fusion: {
        presets: { "effect-box": "fusion-effect-box-s10", frame: "fusion-frame-s10" },
        layerVisibility: {
          atk: true,
          atkLabel: true,
          def: true,
          defLabel: true,
          frameTexture: true,
          levelStar: true,
          link: false,
          linkFrame: false,
          rankStar: false,
          statsSeparator: true,
        },
      },
      link: {
        presets: { "effect-box": "link-effect-box-s10" },
        layerVisibility: {
          atk: true,
          atkLabel: true,
          activeLinkArrowBottomCenter: true,
          activeLinkArrowTopLeft: true,
          def: false,
          defLabel: false,
          frameTexture: false,
          inactiveLinkArrowBottomCenter: false,
          inactiveLinkArrowTopLeft: false,
          levelStar: false,
          link: true,
          linkFrame: true,
          rankStar: false,
          statsSeparator: true,
        },
      },
      normal: {
        presets: { "effect-box": "normal-effect-box-s10", frame: "normal-frame-s10" },
        layerVisibility: {
          atk: true,
          atkLabel: true,
          def: true,
          defLabel: true,
          frameTexture: true,
          levelStar: true,
          link: false,
          linkFrame: false,
          rankStar: false,
          statsSeparator: true,
        },
      },
      ritual: {
        presets: { "effect-box": "ritual-effect-box-s10", frame: "ritual-frame-s10" },
        layerVisibility: {
          atk: true,
          atkLabel: true,
          def: true,
          defLabel: true,
          frameTexture: true,
          levelStar: true,
          link: false,
          linkFrame: false,
          rankStar: false,
          statsSeparator: true,
        },
      },
      synchro: {
        presets: { "effect-box": "synchro-effect-box-s10", frame: "synchro-frame-s10" },
        layerVisibility: {
          atk: true,
          atkLabel: true,
          def: true,
          defLabel: true,
          frameTexture: true,
          levelStar: true,
          link: false,
          linkFrame: false,
          rankStar: false,
          statsSeparator: true,
        },
      },
      xyz: {
        presets: {},
        layerVisibility: {
          atk: true,
          atkLabel: true,
          def: true,
          defLabel: true,
          effectBoxTexture: false,
          frameTexture: false,
          levelStar: false,
          link: false,
          linkFrame: false,
          rankStar: true,
          statsSeparator: true,
          xyzEffectBoxOverlay: true,
          xyzFrame: true,
        },
      },
      token: {
        presets: { "effect-box": "token-effect-box-s10", frame: "token-frame-s10" },
        layerVisibility: {
          atk: false,
          atkLabel: false,
          def: false,
          defLabel: false,
          frameTexture: true,
          levelStar: false,
          link: false,
          linkFrame: false,
          rankStar: false,
          statsSeparator: false,
          typeLine: false,
        },
      },
      "token-with-stats": {
        presets: { "effect-box": "token-effect-box-s10", frame: "token-frame-s10" },
        layerVisibility: {
          atk: true,
          atkLabel: true,
          def: true,
          defLabel: true,
          frameTexture: true,
          levelStar: false,
          link: false,
          linkFrame: false,
          rankStar: false,
          statsSeparator: true,
          typeLine: true,
        },
      },
    } as const

    Object.entries(expected).forEach(([frame, presentationExpected]) => {
      const semantics = deriveCardSemantics(
        {
          cardVariant: frame,
          link: 3,
          linkArrows: ["bottom-center", "top-left"],
          name: "Card",
        },
        official.template,
      )
      const presentation = resolveCardPresentation(official.template, semantics)
      expect(presentation.assetSelections).toStrictEqual({})
      expect(presentation.layerOptions).toStrictEqual(
        frame === "link"
          ? {
              outerBevel: { highlightColor: "#ffe0f052" },
              titleBevel: { highlightColor: "#ffe0f052" },
            }
          : frame === "xyz"
            ? {
                outerBevel: { highlightColor: "#efdfdf52", shadowColor: "#5a47475e" },
                titleBevel: { highlightColor: "#efdfdf52", shadowColor: "#5a47475e" },
              }
            : {},
      )
      expect(presentation.presets).toStrictEqual(presentationExpected.presets)
      expect(presentation.layerVisibility).toMatchObject(presentationExpected.layerVisibility)
      expect(presentation.text.cardCode?.position).toStrictEqual(
        frame === "link" ? { x: 666, y: 870 } : { x: 727, y: 870 },
      )
      if (frame === "link") expect(presentation.text.link?.value).toBe(3)
      if (frame === "xyz") {
        expect(presentation.text.name?.typography.fill).toBe("#ffffff")
        expect(presentation.text.cardCode?.typography.fill).toBe("#ffffff")
        expect(presentation.text.description?.typography.fill).toBe("#111111")
        expect(presentation.text.typeLine?.typography.fill).toBe("#111111")
        expect(presentation.text.atk?.typography.fill).toBe("#111111")
      }
      if (frame === "effect") {
        expect(presentation.layerVisibility.typeLine).not.toBe(false)
        expect(presentation.text.description?.position).toStrictEqual({ x: 65.5, y: 922 })
      }
    })
  })

  it("projects attribute backgrounds and both vector labels from template semantics", () => {
    const official = DEFAULT_TEMPLATE
    const attributeBadge = official.template.layers.find((layer) => layer.id === "attributeBadge")

    expect(attributeBadge?.kind).toBe("group")
    expect(attributeBadge?.kind === "group" ? attributeBadge.layers : []).toHaveLength(11)

    const monsterAttributes = {
      DARK: { glyph: "闇", layer: "attributeDark" },
      DIVINE: { glyph: "神", layer: "attributeDivine" },
      EARTH: { glyph: "地", layer: "attributeEarth" },
      FIRE: { glyph: "炎", layer: "attributeFire" },
      LIGHT: { glyph: "光", layer: "attributeLight" },
      WATER: { glyph: "水", layer: "attributeWater" },
      WIND: { glyph: "風", layer: "attributeWind" },
    } as const

    Object.entries(monsterAttributes).forEach(([attribute, expected]) => {
      const semantics = deriveCardSemantics(
        { attribute, cardVariant: "effect", name: `${attribute} card` },
        official.template,
      )
      const presentation = resolveCardPresentation(official.template, semantics)

      expect(semantics.values["monster.attributeGlyph"]).toBe(expected.glyph)
      expect(presentation.layerVisibility[expected.layer]).toBe(true)
      expect(presentation.layerVisibility.attribute).toBe(true)
      expect(presentation.layerVisibility.attributeGlyph).toBe(true)
      expect(presentation.text.attribute?.value).toBe(attribute)
      expect(presentation.text.attributeGlyph?.value).toBe(expected.glyph)
      expect(presentation.text.attributeGlyph?.typography).toMatchObject({
        fontAssetId: "font.dfp-reisho-w6-jajwa",
        fontFamily: "DFP-ReiSho-W6",
        fontWeight: 400,
      })
      expect(presentation.text.attribute?.typography).toMatchObject({
        fontAssetId: "font.itc-stone-serif-std-bold",
        fontFamily: "StoneSerifStd-Bold",
      })
    })

    const spellPresentation = resolveCardPresentation(
      official.template,
      deriveCardSemantics(
        { cardVariant: "spell", name: "Spell card", spellTrapType: "normal" },
        official.template,
      ),
    )
    const trapPresentation = resolveCardPresentation(
      official.template,
      deriveCardSemantics(
        { cardVariant: "trap", name: "Trap card", spellTrapType: "normal" },
        official.template,
      ),
    )

    expect(spellPresentation.layerVisibility.attributeSpell).toBe(true)
    expect(spellPresentation.text.attribute?.value).toBe("SPELL")
    expect(spellPresentation.text.attributeGlyph?.value).toBe("魔")
    expect(spellPresentation.text.attributeGlyph?.position).toStrictEqual({ x: 714, y: 119 })
    expect(trapPresentation.layerVisibility.attributeTrap).toBe(true)
    expect(trapPresentation.text.attribute?.value).toBe("TRAP")
    expect(trapPresentation.text.attributeGlyph?.value).toBe("罠")
    expect(trapPresentation.text.attributeGlyph?.position).toStrictEqual({ x: 716, y: 119 })
  })

  it("auto-calculates Link rating from unique active arrows when no override is set", () => {
    const official = DEFAULT_TEMPLATE
    const semantics = deriveCardSemantics(
      {
        cardVariant: "link",
        link: 0,
        linkArrows: ["bottom-center", "top-left", "bottom-center"],
        name: "Automatic Link card",
      },
      official.template,
    )

    expect(semantics.values["monster.link.rating"]).toBe(2)
    expect(semantics.values["monster.linkArrows"]).toEqual(["bottom-center", "top-left"])
    expect(resolveCardPresentation(official.template, semantics).text.link?.value).toBe(2)
  })

  it("keeps five-line Monster text large and gives Spell/Trap text two extra lines", () => {
    const official = DEFAULT_TEMPLATE
    const effectSemantics = deriveCardSemantics(
      { cardVariant: "effect", name: "Effect card" },
      official.template,
    )
    const spellSemantics = deriveCardSemantics(
      { cardVariant: "spell", name: "Spell card", spellTrapType: "normal" },
      official.template,
    )

    expect(
      resolveCardPresentation(
        official.template,
        effectSemantics,
      ).text.description?.typography.fitProfiles?.map((profile) => [profile.id, profile.maxLines]),
    ).toEqual([
      ["large", 5],
      ["medium", 6],
      ["small", 7],
      ["extra-small", 9],
    ])
    expect(
      resolveCardPresentation(
        official.template,
        spellSemantics,
      ).text.description?.typography.fitProfiles?.map((profile) => [profile.id, profile.maxLines]),
    ).toEqual([
      ["large", 7],
      ["medium", 8],
      ["small", 9],
      ["extra-small", 10],
    ])
  })

  it("enables authored-line fit blocks only for Extra Deck monster text", () => {
    const official = DEFAULT_TEMPLATE
    const presentationFor = (cardVariant: string) =>
      resolveCardPresentation(
        official.template,
        deriveCardSemantics({ cardVariant, name: `${cardVariant} card` }, official.template),
      ).text.description

    expect(presentationFor("fusion")).toMatchObject({
      styleId: "extra-deck",
      typography: {
        autoScaleXQuantifier: 0.01,
        fitBlocks: { split: "leading-authored-line" },
      },
    })
    expect(presentationFor("link")?.typography.fitBlocks).toMatchObject({
      split: "leading-authored-line",
    })
    expect(presentationFor("effect")?.typography).not.toHaveProperty("fitBlocks")
  })

  it("projects Spell and Trap labels, frames, and subtype icons from template semantics", () => {
    const official = DEFAULT_TEMPLATE
    const cases = [
      {
        cardVariant: "spell",
        icon: "spellTrapIconContinuous",
        descriptionStyle: "spell",
        label: "[Spell Card]",
        labelLayer: "spellTrapLabelSpell",
        preset: "spell-frame-s10",
        effectPreset: "spell-effect-box-s10",
        spellTrapType: "continuous",
      },
      {
        cardVariant: "trap",
        icon: "spellTrapIconCounter",
        descriptionStyle: "trap",
        label: "[Trap Card]",
        labelLayer: "spellTrapLabelTrap",
        preset: "trap-frame-s10",
        effectPreset: "trap-effect-box-s10",
        spellTrapType: "counter",
      },
    ] as const

    cases.forEach(
      ({
        cardVariant,
        descriptionStyle,
        effectPreset,
        icon,
        label,
        labelLayer,
        preset,
        spellTrapType,
      }) => {
        const semantics = deriveCardSemantics(
          {
            attribute: "DARK",
            cardVariant,
            name: `${label} test`,
            spellTrapType,
          },
          official.template,
        )
        const presentation = resolveCardPresentation(official.template, semantics)

        expect(semantics.values.kind).toBe(cardVariant)
        expect(semantics.values[`${cardVariant}.type`]).toBe(spellTrapType)
        expect(semantics.values[`${cardVariant}.label`]).toBe(label)
        expect(semantics.values[`${cardVariant}.bracket`]).toBeUndefined()
        expect(semantics.values["monster.frame"]).toBeUndefined()
        expect(presentation.presets).toStrictEqual({
          frame: preset,
          "effect-box": effectPreset,
        })
        expect(presentation.layerVisibility).toMatchObject({
          frameTexture: true,
          levelStar: false,
          rankStar: false,
          atk: false,
          def: false,
          [icon]: true,
          [labelLayer]: true,
          typeLine: false,
        })
        expect(presentation.text[labelLayer]?.value).toBe(
          cardVariant === "spell"
            ? '[Spell Card<space width="44px"/>]'
            : '[Trap Card<space width="44px"/>]',
        )
        expect(presentation.text.description?.position).toStrictEqual({ x: 65.5, y: 890 })
        expect(presentation.text.description?.styleId).toBe(descriptionStyle)
        expect(presentation.text.description?.typography.maxHeight).toBe(210)
        expect(
          presentation.text.description?.typography.fitProfiles?.map((profile) => [
            profile.id,
            profile.maxLines,
          ]),
        ).toEqual([
          ["large", 7],
          ["medium", 8],
          ["small", 9],
          ["extra-small", 10],
        ])
      },
    )
  })

  it("moves normal Spell/Trap labels to their complete bracketed endpoint", () => {
    const official = DEFAULT_TEMPLATE
    const cases = [
      {
        cardVariant: "spell",
        label: "spellTrapLabelSpell",
        maxWidth: 308,
        path: "spell.label",
      },
      {
        cardVariant: "trap",
        label: "spellTrapLabelTrap",
        maxWidth: 299,
        path: "trap.label",
      },
    ] as const

    cases.forEach(({ cardVariant, label, maxWidth, path }) => {
      const semantics = deriveCardSemantics(
        {
          attribute: "DARK",
          cardVariant,
          name: `${cardVariant} normal card`,
          spellTrapType: "normal",
        },
        official.template,
      )
      const presentation = resolveCardPresentation(official.template, semantics)

      expect(presentation.text[label]?.value).toBe(
        cardVariant === "spell" ? "[Spell Card]" : "[Trap Card]",
      )
      expect(presentation.text[label]?.position).toStrictEqual({ x: 732, y: 184 })
      expect(presentation.text[label]?.typography).toMatchObject({
        maxWidth,
        textAnchor: "end",
      })
      expect(semantics.values[path]).toBe(presentation.text[label]?.value)
    })
  })

  it("uses the expanded upper text layout only for the minimal Token", () => {
    const official = DEFAULT_TEMPLATE
    const tokenSemantics = deriveCardSemantics(
      { cardVariant: "token", name: "Minimal Token" },
      official.template,
    )
    const tokenPresentation = resolveCardPresentation(official.template, tokenSemantics)

    expect(tokenPresentation.text.description?.position).toStrictEqual({ x: 65.5, y: 890 })
    expect(tokenPresentation.text.description?.styleId).toBe("token")
    expect(tokenPresentation.text.description?.typography.maxHeight).toBe(184)
    expect(
      tokenPresentation.text.description?.typography.fitProfiles?.map((profile) => [
        profile.id,
        profile.maxLines,
      ]),
    ).toEqual([
      ["large", 5],
      ["medium", 7],
      ["small", 8],
      ["extra-small", 9],
    ])

    const statsTokenSemantics = deriveCardSemantics(
      { cardVariant: "token-with-stats", name: "Stats Token" },
      official.template,
    )
    const statsTokenPresentation = resolveCardPresentation(official.template, statsTokenSemantics)
    expect(statsTokenPresentation.text.description?.position).toStrictEqual({ x: 65.5, y: 922 })
    expect(statsTokenPresentation.text.description?.styleId).toBe("default")
    expect(statsTokenPresentation.text.description?.typography.maxHeight).toBe(160)
  })

  it("places Spell/Trap text after the raster symbol layers", () => {
    const official = DEFAULT_TEMPLATE
    const layerIds = flattenDrawableLayers(official.template.layers).map((layer) => layer.id)

    expect(layerIds).not.toContain("spellTrapIconNormal")
    expect(layerIds).not.toContain("spellTrapBracketSpell")
    expect(layerIds).not.toContain("spellTrapBracketTrap")
    expect(layerIds.indexOf("spellTrapLabelSpell")).toBeGreaterThan(
      layerIds.indexOf("spellTrapIconRitual"),
    )
    expect(layerIds.indexOf("spellTrapLabelTrap")).toBeGreaterThan(
      layerIds.indexOf("spellTrapIconRitual"),
    )
  })

  it("derives Link rating and active arrows without overlapping inactive arrows", () => {
    const official = DEFAULT_TEMPLATE
    const semantics = deriveCardSemantics(
      {
        cardVariant: "link",
        link: 3,
        linkArrows: ["bottom-center", "top-left"],
        name: "Link card",
      },
      official.template,
    )

    expect(semantics.values).toMatchObject({
      kind: "monster",
      "monster.frame": "link",
      "monster.link.rating": 3,
      "monster.linkArrows.bottom-center": true,
      "monster.linkArrows.top-left": true,
      "monster.linkArrows.top-center": false,
    })
    const visibility = resolveCardPresentation(official.template, semantics).layerVisibility
    expect(visibility).toMatchObject({
      activeLinkArrowBottomCenter: true,
      activeLinkArrowTopLeft: true,
      inactiveLinkArrowBottomCenter: false,
      inactiveLinkArrowTopLeft: false,
      activeLinkArrowTopCenter: false,
      inactiveLinkArrowTopCenter: true,
    })
  })
})
