import { describe, expect, it } from "vitest"

import * as core from "../src/index"

describe("public entry point", () => {
  it("exports only the deliberately supported API", () => {
    // Adding a name here makes it a supported API of the app, the templates package, and the
    // command line's template tooling; removing one is a breaking change for them.
    expect(Object.keys(core).sort()).toEqual([
      "TemplateValidationError",
      "collectLayerGroups",
      "collectPresetTargets",
      "compareTemplateVersions",
      "createCardFromTemplate",
      "createLayerSourceFieldResolver",
      "defaultLayerVisibility",
      "defaultPresetForTarget",
      "deriveCardSemantics",
      "exportCardToImage",
      "exportCardToPng",
      "exportCardToSvg",
      "flattenDrawableLayers",
      "flattenLayers",
      "graphemeCount",
      "hasLeadingAuthoredLineFitSplit",
      "isLayerVisible",
      "isTemplateVersion",
      "matchesPresentationGate",
      "matchesSemanticCondition",
      "parseRichText",
      "parseRichTextLength",
      "parseRichTextScale",
      "plainTextFromRichText",
      "renderCard",
      "resolveCardPresentation",
      "resolveRasterOutputDimensions",
      "richTextHasFormatting",
      "richTextLineLengths",
      "textTypographies",
      "validateCardData",
      "validateCardTemplate",
      "validateColorPresetCollection",
      "validatePresentationOverrides",
      "validateTemplateManifest",
      "walkLayers",
    ])
  })

  it("answers synchronously from the WebAssembly module", () => {
    expect(core.isTemplateVersion("2026.09.23")).toBe(true)
    expect(core.compareTemplateVersions("2026.09.16", "2026.09.23")).toBeLessThan(0)
    expect(core.graphemeCount("\u{1F44D}\u{1F3FD}e\u0301")).toBe(2)
    expect(core.plainTextFromRichText(core.parseRichText("<b>Draw</b> 1 card.").document)).toBe(
      "Draw 1 card.",
    )
  })

  it("throws the package's own error class with the core's message", () => {
    let thrown: unknown
    try {
      core.validateCardTemplate({})
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(core.TemplateValidationError)
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message.length).toBeGreaterThan(0)
  })
})
