import { describe, expect, it } from "vitest"
import {
  collectLayerGroups,
  flattenLayers,
  resolveCardPresentation,
  validateCardData,
  validateCardTemplate,
} from "yugilife-core"

import { DEFAULT_TEMPLATE, TEMPLATE_CATALOG } from "../src"

import type { TextLayer } from "yugilife-core"

describe("Series 10 published contract", () => {
  it("publishes the selected template identity and a valid current-schema template", () => {
    expect(DEFAULT_TEMPLATE.manifest).toMatchObject({
      id: "card/series-10",
      kind: "card",
      name: "Series 10",
      version: "2026.09.23",
    })
    expect(DEFAULT_TEMPLATE.manifest).not.toHaveProperty("references")
    expect(DEFAULT_TEMPLATE.manifest).not.toHaveProperty("status")
    expect(validateCardTemplate(DEFAULT_TEMPLATE.template)).toStrictEqual(DEFAULT_TEMPLATE.template)
    expect(TEMPLATE_CATALOG).toHaveLength(1)
    expect(TEMPLATE_CATALOG[0]).toBe(DEFAULT_TEMPLATE)
    expect(Object.isFrozen(TEMPLATE_CATALOG)).toBe(true)
    expect(Object.isFrozen(DEFAULT_TEMPLATE)).toBe(true)
  })

  it("owns the Series 10 fields, geometry, masks, and editor-visible layer policy", () => {
    const template = DEFAULT_TEMPLATE.template
    expect(template.dimensions).toStrictEqual({ height: 1185, width: 813 })
    expect(template.layers[0]).toMatchObject({
      id: "cardBackground",
      kind: "svg",
      element: {
        tag: "rect",
        attributes: { fill: "#ffffff", height: 1185, width: 813, x: 0, y: 0 },
      },
    })
    expect(template.cardFields.map((field) => field.name)).not.toContain("language")
    expect(template.cardFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "text", name: "attack" }),
        expect.objectContaining({ kind: "text", name: "defense" }),
        expect.objectContaining({ kind: "text", name: "serialNumber" }),
        expect.objectContaining({ kind: "image", name: "artworkOverlay" }),
      ]),
    )
    expect(template.cardFields.find(({ name }) => name === "cardVariant")).toMatchObject({
      defaultValue: "effect",
      required: true,
    })
    expect(template.cardFields.find(({ name }) => name === "sticker")).toMatchObject({
      defaultValue: "none",
    })
    expect(template.cardFields.find(({ name }) => name === "sticker")?.required).not.toBe(true)
    expect(template.cardFields.find(({ name }) => name === "edition")?.suggestions).toContainEqual({
      label: "Limited Edition",
      value: "LIMITED EDITION",
    })
    expect(
      template.cardFields.find(({ name }) => name === "copyright")?.suggestions,
    ).toContainEqual({
      value: '©<scale x="0.7">2020 Studio Dice/SHUEISHA, TV TOKYO, KONAMI</scale>',
    })
    expect(() =>
      validateCardData(
        {
          attack: "?",
          cardVariant: "effect",
          defense: "?",
          name: "Numerounius Numerounia",
        },
        template,
      ),
    ).not.toThrow()
    expect(template.layers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "artwork",
          id: "artwork",
          kind: "artwork",
          region: { height: 613, width: 613, x: 100, y: 219 },
        }),
        expect.objectContaining({
          field: "artwork",
          id: "artworkOverlay",
          kind: "artwork",
          maskField: "artworkOverlay",
          placementRegion: { height: 613, width: 613, x: 100, y: 219 },
          region: { height: 1185, width: 813, x: 0, y: 0 },
          transformId: "artwork",
          transformMode: "full-art",
        }),
        expect.objectContaining({
          field: "artwork",
          fit: "width",
          id: "pendulumArtworkOverlay",
          kind: "artwork",
          maskField: "artworkOverlay",
          placementRegion: { height: 903, width: 703, x: 55, y: 212 },
          region: { height: 1185, width: 813, x: 0, y: 0 },
          transformId: "artwork",
          transformMode: "full-art",
        }),
      ]),
    )
    const layerIds = flattenLayers(template.layers).map(({ id }) => id)
    expect(layerIds.indexOf("artwork")).toBe(layerIds.indexOf("border") + 1)
    expect(layerIds.indexOf("pendulumArtwork")).toBe(layerIds.indexOf("artwork") + 1)
    expect(layerIds.indexOf("frameTexture")).toBeGreaterThan(layerIds.indexOf("pendulumArtwork"))
    expect(layerIds.indexOf("artworkBoxShadow")).toBeLessThan(layerIds.indexOf("artworkBox"))
    expect(layerIds.indexOf("artworkBoxShadow")).toBeLessThan(layerIds.indexOf("artworkOverlay"))
    expect(layerIds.indexOf("linkArrowShadowTopCenter")).toBeLessThan(
      layerIds.indexOf("artworkOverlay"),
    )
    expect(layerIds.indexOf("inactiveLinkArrowTopCenter")).toBeLessThan(
      layerIds.indexOf("artworkOverlay"),
    )
    expect(layerIds.indexOf("artworkBox")).toBeLessThan(
      layerIds.indexOf("linkArrowShadowTopCenter"),
    )
    expect(layerIds.indexOf("artworkBox")).toBeLessThan(layerIds.indexOf("artworkOverlay"))
    expect(layerIds.indexOf("artworkBox")).toBeLessThan(layerIds.indexOf("pendulumArtworkOverlay"))
    expect(layerIds.indexOf("activeLinkArrowTopCenter")).toBeGreaterThan(
      layerIds.indexOf("artworkOverlay"),
    )
    expect(layerIds.indexOf("artworkOverlay")).toBeGreaterThan(layerIds.indexOf("outerBevel"))
    expect(layerIds.indexOf("artworkOverlay")).toBeGreaterThan(layerIds.indexOf("effectBoxTexture"))
    expect(layerIds.indexOf("artworkOverlay")).toBeGreaterThan(layerIds.indexOf("titleBevel"))
    expect(layerIds.indexOf("effectBorderShadow")).toBeLessThan(layerIds.indexOf("artworkOverlay"))
    expect(layerIds.indexOf("artworkOverlay")).toBeLessThan(layerIds.indexOf("effectBorder"))
    expect(layerIds.indexOf("pendulumArtworkOverlay")).toBeGreaterThan(
      layerIds.indexOf("titleBevel"),
    )
    expect(layerIds.indexOf("pendulumArtworkOverlay")).toBeGreaterThan(
      layerIds.indexOf("effectBoxTexture"),
    )
    expect(layerIds.indexOf("effectBoxTexture")).toBeLessThan(
      layerIds.indexOf("pendulumEffectBoxTextures"),
    )
    expect(layerIds.indexOf("pendulumEffectBoxTextures")).toBeLessThan(
      layerIds.indexOf("pendulumUnifiedShadow"),
    )
    expect(layerIds.indexOf("pendulumUnifiedShadow")).toBeLessThan(
      layerIds.indexOf("pendulumArtworkBox"),
    )
    expect(layerIds.indexOf("pendulumArtworkBox")).toBeLessThan(
      layerIds.indexOf("pendulumArtworkOverlay"),
    )
    expect(layerIds.indexOf("pendulumArtworkOverlay")).toBeLessThan(
      layerIds.indexOf("pendulumEffectBox"),
    )
    expect(layerIds.indexOf("pendulumEffectBox")).toBeLessThan(
      layerIds.indexOf("pendulumScaleMarkerLeft"),
    )
    expect(template.layers.find(({ id }) => id === "levelStar")).toMatchObject({
      region: { y: 146 },
    })
    expect(template.layers.find(({ id }) => id === "rankStar")).toMatchObject({
      region: { y: 146 },
    })
    const editorLayerIds = collectLayerGroups(template).flatMap((group) =>
      group.layers.map(({ id }) => id),
    )
    expect(editorLayerIds).not.toEqual(
      expect.arrayContaining([
        "artworkBoxShadow",
        "effectBorderShadow",
        "linkArrowShadowTopCenter",
        "linkArrowShadowTopRight",
        "linkArrowShadowRightCenter",
        "linkArrowShadowBottomRight",
        "linkArrowShadowBottomCenter",
        "linkArrowShadowBottomLeft",
        "linkArrowShadowLeftCenter",
        "linkArrowShadowTopLeft",
        "pendulumMonsterFrameTexture",
        "pendulumXyzFrameTexture",
        "pendulumUnifiedShadow",
        "pendulumArtworkBox",
        "pendulumEffectBox",
      ]),
    )
    expect(template.masks).toEqual(
      expect.arrayContaining([
        { assetId: "card.series-10.artwork-mask", id: "artwork-mask", invert: true },
        { assetId: "card.series-10.pendulum-artwork-mask", id: "pendulum-artwork-mask" },
        { assetId: "card.series-10.full-art-coverage", id: "full-art-coverage" },
        {
          assetId: "card.series-10.pendulum-frame-transition",
          id: "pendulum-frame-transition",
        },
        {
          assetId: "card.series-10.pendulum-artwork-mask",
          id: "pendulum-frame-clip",
          invert: true,
        },
        {
          assetId: "card.series-10.pendulum-texture-opacity",
          coverageLayerId: "pendulumArtwork",
          id: "pendulum-texture-opacity",
        },
      ]),
    )
    const linkArrowGroup = template.layers.find((layer) => layer.id === "linkArrowLayers")
    const inactiveLinkArrowGroup = template.layers.find(
      (layer) => layer.id === "inactiveLinkArrowLayers",
    )
    const linkArrowShadowGroup = template.layers.find((layer) => layer.id === "linkArrowShadows")
    expect(linkArrowGroup?.kind).toBe("group")
    expect(inactiveLinkArrowGroup?.kind).toBe("group")
    expect(linkArrowShadowGroup?.kind).toBe("group")
    if (linkArrowGroup?.kind === "group") {
      expect(linkArrowGroup.layers).toHaveLength(8)
    }
    if (inactiveLinkArrowGroup?.kind === "group") {
      expect(inactiveLinkArrowGroup.layers).toHaveLength(8)
    }
    if (linkArrowShadowGroup?.kind === "group") {
      expect(linkArrowShadowGroup.layers).toHaveLength(8)
    }
  })

  it("publishes only referenced semantic assets and required fonts", () => {
    const assets = DEFAULT_TEMPLATE.assets
    expect(assets["card.series-10.border"]).toMatch(/border\.(?:png|webp)$/u)
    expect(assets["card.series-10.artwork-mask"]).toMatch(/artwork-mask\.(?:png|webp)$/u)
    expect(assets).toHaveProperty("card.series-10.artwork-box-shadow")
    expect(assets).toHaveProperty("card.series-10.effects-border-shadow")
    expect(assets).toHaveProperty("card.series-10.pendulum.unified-shadow.small")
    expect(assets).toHaveProperty("card.series-10.pendulum.artwork-box.medium")
    expect(assets).toHaveProperty("card.series-10.pendulum.effect-box.large")
    expect(assets).toHaveProperty("card.series-10.link-arrow.shadow.top-center")
    expect(assets).not.toHaveProperty("card.series-10.link-arrows-mask")
    expect(assets["card.series-10.xyz-texture"]).toMatch(/xyz-texture\.(?:png|webp)$/u)
    expect(assets["card.series-10.pendulum-scale.left"]).toMatch(
      /pendulum-scale-left\.(?:png|webp)$/u,
    )
    expect(assets["card.series-10.pendulum-scale.right"]).toMatch(
      /pendulum-scale-right\.(?:png|webp)$/u,
    )
    expect(assets).not.toHaveProperty("card.series-10.spell-trap.icon.normal")
    expect(assets).not.toHaveProperty("card.series-10.spell-trap.label.spell")
    expect(Object.keys(assets).filter((id) => id.startsWith("font."))).toHaveLength(10)
    expect(assets).toHaveProperty("font.itc-stone-serif-medium-italic")
    expect(assets).toHaveProperty("font.itc-stone-serif-std-bold")
    expect(assets).toHaveProperty("font.dfp-reisho-w6-jajwa")
    expect(assets).toHaveProperty("font.rogsansrfstd-bd")
    expect(assets).toHaveProperty("font.stone-serif-itc-semi")
  })

  it("owns its typography, color presets, and frame mask selection", () => {
    const description = DEFAULT_TEMPLATE.template.layers.find(
      (layer) => layer.id === "description",
    ) as TextLayer | undefined
    expect(description?.typography.textAlign).toBe("justify")
    expect(DEFAULT_TEMPLATE.colorPresets).not.toHaveProperty("effect-frame-s10")
    expect(DEFAULT_TEMPLATE.colorPresets["effect-box-s10"]?.metadata?.target).toBe("effect-box")
    expect(DEFAULT_TEMPLATE.colorPresets).not.toHaveProperty("xyz-effect-box-s10")

    const presentation = resolveCardPresentation(DEFAULT_TEMPLATE.template, {
      values: {
        kind: "monster",
        "monster.frame": "effect",
        "monster.pendulum": false,
        "monster.pendulumSupported": true,
      },
    })
    expect(presentation.presets).not.toHaveProperty("frame")
    expect(presentation.layerMasks.frameTexture).toMatchObject({
      assetId: "card.series-10.artwork-mask",
      channel: "luminance",
      id: "artwork-mask",
      invert: true,
    })
    const pendulumPresentation = resolveCardPresentation(DEFAULT_TEMPLATE.template, {
      values: {
        kind: "monster",
        "monster.frame": "effect",
        "monster.pendulum": true,
        "monster.pendulumSupported": true,
      },
    })
    expect(pendulumPresentation.layerVisibility).toMatchObject({
      artwork: false,
      artworkOverlay: false,
      pendulumArtwork: true,
      pendulumArtworkOverlay: true,
      pendulumUnifiedShadow: true,
      pendulumArtworkBox: true,
      pendulumEffectBox: true,
    })
    const linkPresentation = resolveCardPresentation(DEFAULT_TEMPLATE.template, {
      values: {
        kind: "monster",
        "monster.frame": "link",
        "monster.pendulum": false,
        "monster.pendulumSupported": true,
      },
    })
    expect(linkPresentation.layerMasks.linkArrowShadows).toMatchObject({
      assetId: "card.series-10.artwork-mask",
      channel: "luminance",
      id: "artwork-mask",
      invert: true,
    })
    expect(linkPresentation.layerMasks).not.toHaveProperty("linkArrowLayers")
    expect(linkPresentation.layerMasks).not.toHaveProperty("inactiveLinkArrowLayers")
    expect(linkPresentation.layerVisibility.linkArrowShadows).toBe(true)
  })
})
