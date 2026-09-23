import { describe, expect, it } from "vitest"
import { deriveCardSemantics, resolveCardPresentation } from "yugilife-core"

import {
  artworkEditorConfig,
  automaticTextFitLayerIds,
  countActivePresentationOverrides,
  createInitialCard,
  editorCardFieldsForMode,
  editorDefaultLayerVisibility,
  editorLayerGroups,
  editorTemplate,
  getActivePresentationOverrides,
  hasArtworkCrop,
  projectCardForEditorMode,
  projectCardForRender,
  resetArtworkCrop,
  shouldRenderArtworkWorkspace,
  toggleArtworkFullArt,
} from "./editor-config"

describe("editor card projections", () => {
  it("projects advanced-only fields while preserving the advanced override", () => {
    const card = {
      ...createInitialCard(),
      link: 7,
      linkArrows: ["bottom-center", "top-left"],
      cardVariant: "link",
    }

    const automatic = projectCardForEditorMode(card, "automatic")
    expect(automatic.link).toBeUndefined()
    expect(card.link).toBe(7)

    expect(projectCardForEditorMode({ ...card, link: 0 }, "advanced").link).toBe(0)
    expect(projectCardForEditorMode(card, "advanced").link).toBe(7)
  })

  it("projects the active editor-owned artwork mask into every render card", () => {
    const card = { ...createInitialCard(), artworkOverlay: "legacy-mask" }
    const automaticMask = new Blob(["automatic-mask"], { type: "image/png" })
    const manualMask = new Blob(["manual-mask"], { type: "image/png" })

    expect(
      projectCardForRender(card, "automatic", {
        automaticMask,
        mode: "automatic",
        points: [],
      }).artworkOverlay,
    ).toBe(automaticMask)
    expect(
      projectCardForRender(card, "automatic", {
        automaticMask,
        manualMask,
        mode: "manual",
        points: [],
      }).artworkOverlay,
    ).toBe(manualMask)
    expect(
      projectCardForRender(card, "automatic", {
        automaticMask,
        mode: "manual",
        points: [],
      }).artworkOverlay,
    ).toBe("")
  })

  it("derives the unified card variant and conditional Spell/Trap subtype fields from the template", () => {
    expect(createInitialCard()).toMatchObject({
      cardVariant: "effect",
      pendulum: false,
      pendulumSize: "medium",
      scales: [1, 1],
      spellTrapType: "normal",
    })
    expect([...automaticTextFitLayerIds].sort()).toEqual(["description", "pendulumEffect"])
    expect(artworkEditorConfig()).toEqual({
      field: "artwork",
      maskChannel: "luminance",
      maskField: "artworkOverlay",
      supportsFullArt: true,
      transformId: "artwork",
    })
  })

  it("shows only semantically active fields in Automatic mode and keeps all fields in Advanced mode", () => {
    const card = createInitialCard()
    const automaticSpellFields = editorCardFieldsForMode(
      { ...card, cardVariant: "spell" },
      "automatic",
    ).map((field) => field.name)
    const automaticXyzFields = editorCardFieldsForMode(
      { ...card, cardVariant: "xyz" },
      "automatic",
    ).map((field) => field.name)
    const automaticTokenFields = editorCardFieldsForMode(
      { ...card, cardVariant: "token" },
      "automatic",
    ).map((field) => field.name)
    const automaticTokenWithStatsFields = editorCardFieldsForMode(
      { ...card, cardVariant: "token-with-stats" },
      "automatic",
    ).map((field) => field.name)
    const automaticPendulumFields = editorCardFieldsForMode(
      { ...card, cardVariant: "effect", pendulum: true },
      "automatic",
    ).map((field) => field.name)
    const advancedSpellFields = editorCardFieldsForMode(
      { ...card, cardVariant: "spell" },
      "advanced",
    ).map((field) => field.name)

    expect(automaticSpellFields).toEqual(
      expect.arrayContaining(["cardVariant", "spellTrapType", "name", "description"]),
    )
    expect(automaticSpellFields).not.toEqual(
      expect.arrayContaining([
        "attribute",
        "level",
        "rank",
        "scales",
        "types",
        "attack",
        "defense",
        "linkArrows",
      ]),
    )
    expect(automaticXyzFields).toEqual(expect.arrayContaining(["rank", "attack", "defense"]))
    expect(automaticXyzFields).not.toContain("level")
    expect(automaticTokenFields).not.toEqual(expect.arrayContaining(["types", "attack", "defense"]))
    expect(automaticTokenWithStatsFields).toEqual(
      expect.arrayContaining(["types", "attack", "defense"]),
    )
    expect(automaticTokenWithStatsFields).not.toContain("level")
    expect(automaticPendulumFields).toEqual(
      expect.arrayContaining(["pendulum", "pendulumSize", "scales", "pendulumEffect"]),
    )
    expect(advancedSpellFields).toEqual(
      expect.arrayContaining([
        "attribute",
        "cardVariant",
        "spellTrapType",
        "level",
        "rank",
        "scales",
        "types",
        "attack",
        "defense",
        "linkArrows",
        "pendulum",
        "pendulumSize",
        "pendulumEffect",
      ]),
    )
  })

  it("counts only presentation overrides that change the current result", () => {
    const card = createInitialCard()
    const presentation = resolveCardPresentation(
      editorTemplate,
      deriveCardSemantics(card, editorTemplate),
    )

    expect(countActivePresentationOverrides({ border: false }, {}, {}, presentation)).toBe(1)
    expect(
      countActivePresentationOverrides(
        { border: editorDefaultLayerVisibility.border },
        {},
        {},
        presentation,
      ),
    ).toBe(0)
    expect(
      countActivePresentationOverrides(
        {},
        {},
        { textFitProfiles: { description: { default: "medium" } } },
        presentation,
      ),
    ).toBe(0)
    expect(
      countActivePresentationOverrides(
        {},
        {},
        { textTypography: { spellTrapLabelSpell: { default: { fill: "#f00" } } } },
        presentation,
      ),
    ).toBe(0)
    expect(
      countActivePresentationOverrides(
        {},
        {},
        { artworkTransforms: { artwork: { scale: 1, x: 0, y: 0 } } },
        presentation,
      ),
    ).toBe(0)
    expect(
      countActivePresentationOverrides(
        {},
        {},
        { artworkTransforms: { artwork: { mode: "full-art", scale: 1, x: 0, y: 0 } } },
        presentation,
      ),
    ).toBe(1)
    expect(
      countActivePresentationOverrides({}, {}, {}, presentation, undefined, undefined, {
        artworkOverlay: { antiAlias: true },
      }),
    ).toBe(1)
    expect(
      countActivePresentationOverrides({}, {}, {}, presentation, undefined, undefined, {
        artworkOverlay: { antiAlias: false, glow: 0 },
      }),
    ).toBe(0)
  })

  it("starts full art at 150% and clears the crop override when disabled", () => {
    const cropped = { scale: 2.1, x: -0.25, y: 0.4 }
    expect(toggleArtworkFullArt(cropped)).toEqual({ ...cropped, mode: "full-art" })
    expect(toggleArtworkFullArt({ ...cropped, mode: "full-art" })).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    })
    expect(toggleArtworkFullArt({ scale: 1, x: 0, y: 0 })).toEqual({
      mode: "full-art",
      scale: 1.5,
      x: 0,
      y: 0,
    })
  })

  it("clears the crop without deciding the layout the card is built in", () => {
    const cropped = { scale: 2.1, x: -0.25, y: 0.4 }

    // Full art resets to the zoom it opens at, not to the framed placement.
    expect(resetArtworkCrop({ ...cropped, mode: "full-art" })).toEqual({
      mode: "full-art",
      scale: 1.5,
      x: 0,
      y: 0,
    })
    expect(resetArtworkCrop(cropped)).toEqual({ mode: undefined, scale: 1, x: 0, y: 0 })
    expect(hasArtworkCrop(cropped)).toBe(true)
    // Full art alone is not a crop: the reset has nothing left to undo.
    expect(hasArtworkCrop({ mode: "full-art", scale: 1.5, x: 0, y: 0 })).toBe(false)
    expect(hasArtworkCrop({ mode: "full-art", scale: 1, x: 0, y: 0 })).toBe(true)
  })

  it("enables the side-by-side artwork workspace only for full-art editing", () => {
    const artwork = new Blob(["artwork"], { type: "image/png" })

    expect(shouldRenderArtworkWorkspace(artwork, undefined)).toBe(false)
    expect(shouldRenderArtworkWorkspace(artwork, { scale: 1, x: 0, y: 0 })).toBe(false)
    expect(
      shouldRenderArtworkWorkspace("asset-url", {
        mode: "full-art",
        scale: 1,
        x: 0,
        y: 0,
      }),
    ).toBe(false)
    expect(
      shouldRenderArtworkWorkspace(artwork, {
        mode: "full-art",
        scale: 1.5,
        x: 0,
        y: 0,
      }),
    ).toBe(true)
  })

  it("describes each currently effective override using template-derived labels", () => {
    const card = createInitialCard()
    const overrides = {
      layerMasks: { frameTexture: null },
      textTypography: { description: { default: { fill: "#f00" } } },
    }
    const presentation = resolveCardPresentation(
      editorTemplate,
      deriveCardSemantics(card, editorTemplate),
      overrides,
    )
    const active = getActivePresentationOverrides(
      { border: false },
      { frame: "fusion-frame-s10" },
      overrides,
      presentation,
      undefined,
      undefined,
      { artworkOverlay: { antiAlias: true, glow: 12 } },
    )

    expect(active).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "artwork-mask-effects:artworkOverlay",
          label: "Artwork mask edges",
          value: "anti-aliasing, 12px glow",
        }),
        expect.objectContaining({
          id: "layer:border",
          label: "Border visibility",
          value: "Hidden",
        }),
        expect.objectContaining({
          id: "preset:frame",
          label: "Frame preset",
          value: "fusion-frame-s10",
        }),
        expect.objectContaining({
          id: "text-typography:description:default",
          label: "Monster text typography",
          value: "color: #f00",
        }),
        expect.objectContaining({
          id: "layer-mask:frameTexture",
          label: "Frame texture mask",
          value: "No mask",
        }),
      ]),
    )
    expect(active).toHaveLength(5)
    expect(
      countActivePresentationOverrides(
        { border: false },
        { frame: "fusion-frame-s10" },
        overrides,
        presentation,
        undefined,
        undefined,
        { artworkOverlay: { antiAlias: true, glow: 12 } },
      ),
    ).toBe(active.length)
  })

  it("hides renderer-only Pendulum frame layers from editor visibility controls", () => {
    const layerIds = editorLayerGroups.flatMap((group) => group.layers.map(({ id }) => id))
    expect(layerIds).not.toEqual(
      expect.arrayContaining(["pendulumMonsterFrameTexture", "pendulumXyzFrameTexture"]),
    )
  })
})
