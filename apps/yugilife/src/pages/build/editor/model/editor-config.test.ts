import { describe, expect, it } from "vitest"
import { deriveCardSemantics, resolveCardPresentation } from "yugilife-core"

import {
  automaticTextFitLayerIds,
  countActivePresentationOverrides,
  createInitialCard,
  editorCardFieldsForMode,
  editorDefaultLayerVisibility,
  editorLayerGroups,
  editorTemplate,
  getActivePresentationOverrides,
  projectCardForEditorMode,
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

  it("derives the unified card variant and conditional Spell/Trap subtype fields from the template", () => {
    expect(createInitialCard()).toMatchObject({
      cardVariant: "effect",
      pendulum: false,
      pendulumSize: "medium",
      scales: [1, 1],
      spellTrapType: "normal",
    })
    expect([...automaticTextFitLayerIds].sort()).toEqual(["description", "pendulumEffect"])
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
    )

    expect(active).toEqual(
      expect.arrayContaining([
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
          value: "fill: #f00",
        }),
        expect.objectContaining({
          id: "layer-mask:frameTexture",
          label: "Frame texture mask",
          value: "No mask",
        }),
      ]),
    )
    expect(active).toHaveLength(4)
    expect(
      countActivePresentationOverrides(
        { border: false },
        { frame: "fusion-frame-s10" },
        overrides,
        presentation,
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
