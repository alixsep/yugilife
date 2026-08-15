import { describe, expect, it } from "vitest"
import { createCardFromTemplate, deriveCardSemantics, resolveCardPresentation } from "yugilife-core"

import { DEFAULT_TEMPLATE } from "../src"

import type { CardData } from "yugilife-core"

const template = DEFAULT_TEMPLATE.template

function card(overrides: Partial<CardData> = {}): CardData {
  return {
    ...createCardFromTemplate(template),
    ...overrides,
  }
}

function presentation(overrides: Partial<CardData> = {}) {
  const source = card(overrides)
  return resolveCardPresentation(template, deriveCardSemantics(source, template))
}

describe("Series 10 Pendulum modifier", () => {
  it("keeps Pendulum independent from the base monster frame", () => {
    const semantics = deriveCardSemantics(
      card({ cardVariant: "effect", pendulum: true, pendulumSize: "medium" }),
      template,
    )

    expect(semantics.values).toMatchObject({
      kind: "monster",
      "monster.frame": "effect",
      "monster.pendulum": true,
      "monster.pendulum.size": "medium",
      "monster.pendulumSupported": true,
    })

    const resolved = resolveCardPresentation(template, semantics)
    expect(resolved.presets).toStrictEqual({
      "effect-box": "spell-effect-box-s10",
    })
    expect(resolved.layerVisibility).toMatchObject({
      frameTexture: false,
      effectBoxTexture: true,
      pendulumArtwork: true,
      pendulumBorder: true,
      pendulumEffectTexture: true,
      pendulumEffectTextureLarge: false,
      pendulumMonsterFrameTexture: true,
      pendulumSpellFrameTexture: true,
      pendulumEffect: true,
      pendulumScaleMarkerLeft: true,
      pendulumScaleMarkerRight: true,
      pendulumScaleLeft: true,
      pendulumScaleRight: true,
    })
    expect(resolved.layerMasks).toMatchObject({
      pendulumArtwork: {
        id: "pendulum-artwork-mask",
        invert: false,
      },
      pendulumMonsterFrameTexture: {
        assetId: "card.series-10.pendulum-artwork-mask",
        id: "pendulum-artwork-cutout",
        invert: true,
      },
      pendulumSpellFrameTexture: {
        assetId: "card.series-10.pendulum-frame-mask.spell",
        id: "pendulum-frame-spell",
        invert: false,
      },
      pendulumXyzFrameTexture: {
        assetId: "card.series-10.pendulum-artwork-mask",
        id: "pendulum-artwork-cutout",
        invert: true,
      },
      pendulumEffectTexture: {
        assetId: "card.series-10.pendulum-effect-mask.medium",
        id: "pendulum-effect-box-medium",
        invert: false,
      },
    })
    expect(resolved.text.cardCode).toMatchObject({
      position: { x: 68, y: 1105.5 },
      typography: { fill: "#111111", textAnchor: "start" },
    })
    expect(resolved.text.serialNumber?.typography.fill).toBe("#111111")
    expect(resolved.text.edition?.typography.fill).toBe("#111111")
    expect(resolved.text.copyright?.typography.fill).toBe("#111111")
    expect(resolved.assetSelections.pendulumBorder).toBe("card.series-10.pendulum-border.medium")

    const pendulumMonsterFrame = template.layers.find(
      (layer) => layer.id === "pendulumMonsterFrameTexture",
    )
    const pendulumSpellFrame = template.layers.find(
      (layer) => layer.id === "pendulumSpellFrameTexture",
    )
    const ordinaryOuterBevel = template.layers.find((layer) => layer.id === "outerBevel")

    expect(pendulumMonsterFrame).toMatchObject({
      kind: "raster",
      renderer: "color-texture-bevel",
    })
    expect(pendulumSpellFrame).toMatchObject({
      kind: "raster",
      renderer: "color-texture-bevel",
    })
    if (pendulumSpellFrame?.kind !== "raster" || ordinaryOuterBevel?.kind !== "canvas") {
      throw new Error("The Series 10 Pendulum Spell and ordinary bevel layers are missing.")
    }
    expect(pendulumSpellFrame.options).toStrictEqual(ordinaryOuterBevel.options)
    expect(template.layers.some((layer) => layer.id === "pendulumMonsterBevel")).toBe(false)
    expect(template.layers.some((layer) => layer.id === "pendulumSpellBevel")).toBe(false)

    const cardWithoutOptionalSize = card({ cardVariant: "effect", pendulum: true })
    delete cardWithoutOptionalSize.pendulumSize
    expect(
      deriveCardSemantics(cardWithoutOptionalSize, template).values["monster.pendulum.size"],
    ).toBe("medium")
  })

  it("changes the border, box, and marker geometry when the size changes", () => {
    const small = presentation({ cardVariant: "fusion", pendulum: true, pendulumSize: "small" })
    const large = presentation({ cardVariant: "fusion", pendulum: true, pendulumSize: "large" })

    expect(small.assetSelections.pendulumBorder).toBe("card.series-10.pendulum-border.small")
    expect(large.assetSelections.pendulumBorder).toBe("card.series-10.pendulum-border.large")
    expect(small.presets["effect-box"]).toBe("spell-effect-box-s10")
    expect(large.presets["effect-box"]).toBe("spell-effect-box-s10")
    expect(small.layerVisibility).toMatchObject({
      effectBoxTexture: true,
      pendulumEffectTexture: true,
      pendulumEffectTextureLarge: false,
      pendulumScaleMarkerLeft: true,
      pendulumScaleMarkerRight: true,
    })
    expect(small.layerRegions).toMatchObject({
      pendulumScaleMarkerLeft: { x: 59, y: 793, width: 51, height: 39 },
      pendulumScaleMarkerRight: { x: 704, y: 793, width: 51, height: 39 },
    })
    expect(small.layerMasks.pendulumEffectTexture?.id).toBe("pendulum-effect-box-small")
    expect(large.layerVisibility).toMatchObject({
      effectBoxTexture: true,
      pendulumEffectTexture: false,
      pendulumEffectTextureLarge: true,
      pendulumScaleMarkerLeft: true,
      pendulumScaleMarkerRight: true,
    })
    expect(large.layerRegions).toMatchObject({
      pendulumScaleMarkerLeft: { x: 59, y: 785, width: 51, height: 39 },
      pendulumScaleMarkerRight: { x: 704, y: 785, width: 51, height: 39 },
    })
    expect(large.layerMasks.effectBoxTexture?.id).toBe("pendulum-effect-box-large-lower")
    expect(large.layerMasks.pendulumEffectTextureLarge?.id).toBe("pendulum-effect-box-large")
    expect(small.text.pendulumEffect?.position).toStrictEqual({ x: 130, y: 788 })
    expect(large.text.pendulumEffect?.position).toStrictEqual({ x: 130, y: 748 })
    expect(large.text.pendulumEffect?.typography.maxWidth).toBe(556)
    expect(large.text.pendulumEffect?.typography.fitProfiles).toEqual([
      {
        id: "large",
        label: "Large",
        fontSize: 30,
        lineHeight: 29.5,
        maxLines: 7,
      },
      {
        id: "medium",
        label: "Medium",
        fontSize: 24.4,
        lineHeight: 25,
        maxLines: 8,
      },
      {
        id: "small",
        label: "Small",
        fontSize: 21,
        lineHeight: 21,
        maxLines: 9,
      },
    ])
    expect(large.text.pendulumEffect?.typography.maxAutoCompressionX).toBe(0.2)
    expect(small.text.description?.position).toStrictEqual({ x: 65.5, y: 922 })
    expect(large.text.description?.position).toStrictEqual({ x: 65.5, y: 952 })
    expect(large.text.description?.styleId).toBe("pendulum-large")
    expect(large.text.description?.typography.fitBlocks).toMatchObject({
      split: "leading-authored-line",
    })
    const mainDeckDescription = presentation({
      cardVariant: "effect",
      pendulum: true,
      pendulumSize: "large",
    }).text.description
    expect(mainDeckDescription?.styleId).toBe("pendulum-large-main-deck")
    expect(
      mainDeckDescription?.typography.fitProfiles?.find(({ id }) => id === "extra-small"),
    ).toMatchObject({ lineHeight: 16.5, maxLines: 7 })
    expect(mainDeckDescription?.typography).not.toHaveProperty("fitBlocks")
    expect(
      large.text.description?.typography.fitProfiles?.find(({ id }) => id === "extra-small"),
    ).toMatchObject({ lineHeight: 16.5, maxLines: 7 })

    expect(
      presentation({ cardVariant: "effect", pendulum: true, pendulumSize: "medium" }).text
        .description?.typography.fitProfiles,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ id: "small", lineHeight: 21.5 })]))
  })

  it("uses Spell grading for every non-XYZ Pendulum effect box", () => {
    for (const cardVariant of ["normal", "effect", "ritual", "fusion", "synchro"] as const) {
      expect(presentation({ cardVariant, pendulum: true }).presets["effect-box"]).toBe(
        "spell-effect-box-s10",
      )
    }
  })

  it("switches from a Fusion Pendulum frame to the XYZ Pendulum frame without conflicts", () => {
    const resolved = presentation({ cardVariant: "xyz", pendulum: true, pendulumSize: "medium" })

    expect(resolved.layerVisibility).toMatchObject({
      xyzFrame: false,
      effectBoxTexture: true,
      pendulumMonsterFrameTexture: false,
      pendulumXyzFrameTexture: true,
      pendulumSpellFrameTexture: true,
      rankStar: true,
    })
    expect(resolved.presets["effect-box"]).toBe("spell-effect-box-s10")
    expect(resolved.assetSelections).not.toHaveProperty("effectBoxTexture")
    expect(resolved.layerMasks.pendulumXyzFrameTexture).toMatchObject({
      assetId: "card.series-10.pendulum-artwork-mask",
      id: "pendulum-artwork-cutout",
      invert: true,
    })
    expect(resolved.layerOptions.titleBevel).toMatchObject({
      highlightColor: "#efdfdf52",
      shadowColor: "#5a47475e",
    })
  })

  it("preserves the ordinary presentation for a non-Pendulum card", () => {
    const resolved = presentation({ cardVariant: "effect", pendulum: false })

    expect(resolved.presets).toStrictEqual({
      "effect-box": "effect-box-s10",
    })
    expect(resolved.layerVisibility.frameTexture).toBe(true)
    expect(resolved.layerVisibility.pendulumBorder).toBeUndefined()
    expect(resolved.layerMasks.frameTexture?.id).toBe("artwork-mask")
  })

  it("masks standalone Link and XYZ frame textures to the artwork window", () => {
    const xyz = presentation({ cardVariant: "xyz", pendulum: false })
    const link = presentation({ cardVariant: "link", pendulum: false })

    expect(xyz.layerMasks.xyzFrame).toMatchObject({
      assetId: "card.series-10.artwork-mask",
      id: "artwork-mask",
      invert: true,
    })
    expect(link.layerMasks.linkFrame).toMatchObject({
      assetId: "card.series-10.artwork-mask",
      id: "artwork-mask",
      invert: true,
    })
  })

  it("falls back to the base presentation for unsupported modifier combinations", () => {
    const resolved = presentation({ cardVariant: "token", pendulum: true })

    expect(resolved.presets).toStrictEqual({
      frame: "token-frame-s10",
      "effect-box": "token-effect-box-s10",
    })
    expect(resolved.layerVisibility.frameTexture).toBe(true)
    expect(resolved.layerVisibility.pendulumBorder).toBeUndefined()
  })

  it("declares full-width, aspect-preserving artwork and independent scale slots", () => {
    const artwork = template.layers.find((layer) => layer.id === "pendulumArtwork")
    const scaleLeft = template.layers.find((layer) => layer.id === "pendulumScaleLeft")
    const scaleRight = template.layers.find((layer) => layer.id === "pendulumScaleRight")
    const effectTexture = template.layers.find((layer) => layer.id === "pendulumEffectTexture")
    const largeEffectTexture = template.layers.find(
      (layer) => layer.id === "pendulumEffectTextureLarge",
    )
    const scaleMarkers = template.layers.filter((layer) =>
      layer.id.startsWith("pendulumScaleMarker"),
    )

    expect(artwork).toMatchObject({
      fit: "width",
      region: { x: 55, y: 212, width: 703, height: 903 },
    })
    expect(scaleLeft).toMatchObject({ format: "pair", pairIndex: 0 })
    expect(scaleRight).toMatchObject({ format: "pair", pairIndex: 1 })
    expect(scaleMarkers).toHaveLength(2)
    expect(scaleMarkers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetId: "card.series-10.pendulum-scale.left",
          id: "pendulumScaleMarkerLeft",
          region: { x: 59, y: 769, width: 51, height: 39 },
        }),
        expect.objectContaining({
          assetId: "card.series-10.pendulum-scale.right",
          id: "pendulumScaleMarkerRight",
          region: { x: 704, y: 769, width: 51, height: 39 },
        }),
      ]),
    )
    expect(effectTexture).toMatchObject({
      kind: "raster",
      assetId: "card.series-10.frame-texture",
      defaultPreset: "spell-effect-box-s10",
      region: { x: 52, y: 645, width: 709, height: 237 },
      sourceRegion: { x: 24, y: 854, width: 709, height: 237 },
    })
    expect(largeEffectTexture).toMatchObject({
      region: { x: 52, y: 676, width: 709, height: 237 },
    })
    expect(template.layers.find((layer) => layer.id === "effectBoxTexture")).toMatchObject({
      region: { x: 52, y: 882, width: 709, height: 237 },
      sourceRegion: { x: 24, y: 854, width: 709, height: 237 },
      presetTarget: "effect-box",
    })
    expect(
      template.layers.findIndex((layer) => layer.id === "pendulumSpellFrameTexture"),
    ).toBeGreaterThan(
      template.layers.findIndex((layer) => layer.id === "pendulumMonsterFrameTexture"),
    )
    expect(
      template.layers.findIndex((layer) => layer.id === "pendulumSpellFrameTexture"),
    ).toBeLessThan(template.layers.findIndex((layer) => layer.id === "pendulumEffectTexture"))
  })
})
