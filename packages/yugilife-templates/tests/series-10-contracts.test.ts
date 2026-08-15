import { describe, expect, it } from "vitest"
import {
  collectLayerGroups,
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
      version: "2026.08.15",
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
      ]),
    )
    expect(template.cardFields.find(({ name }) => name === "cardVariant")).toMatchObject({
      defaultValue: "effect",
      required: true,
    })
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
      ]),
    )
    const editorLayerIds = collectLayerGroups(template).flatMap((group) =>
      group.layers.map(({ id }) => id),
    )
    expect(editorLayerIds).not.toEqual(
      expect.arrayContaining(["pendulumMonsterFrameTexture", "pendulumXyzFrameTexture"]),
    )
    expect(template.masks).toEqual(
      expect.arrayContaining([
        { assetId: "card.series-10.artwork-mask", id: "artwork-mask", invert: true },
        { assetId: "card.series-10.link-arrows-mask", id: "link-arrows" },
        { assetId: "card.series-10.pendulum-artwork-mask", id: "pendulum-artwork-mask" },
        {
          assetId: "card.series-10.pendulum-artwork-mask",
          id: "pendulum-artwork-cutout",
          invert: true,
        },
        { assetId: "card.series-10.pendulum-frame-mask.spell", id: "pendulum-frame-spell" },
      ]),
    )
    const linkArrowGroup = template.layers.find((layer) => layer.id === "linkArrowLayers")
    expect(linkArrowGroup?.kind).toBe("group")
    if (linkArrowGroup?.kind === "group") {
      expect(linkArrowGroup.layers).toHaveLength(16)
    }
  })

  it("publishes only referenced semantic assets and required fonts", () => {
    const assets = DEFAULT_TEMPLATE.assets
    expect(assets["card.series-10.border"]).toMatch(/border\.(?:png|webp)$/u)
    expect(assets["card.series-10.artwork-mask"]).toMatch(/artwork-mask\.(?:png|webp)$/u)
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
    const linkPresentation = resolveCardPresentation(DEFAULT_TEMPLATE.template, {
      values: {
        kind: "monster",
        "monster.frame": "link",
        "monster.pendulum": false,
        "monster.pendulumSupported": true,
      },
    })
    expect(linkPresentation.layerMasks.linkArrowLayers).toMatchObject({
      assetId: "card.series-10.link-arrows-mask",
      channel: "luminance",
      id: "link-arrows",
      invert: false,
    })
  })
})
