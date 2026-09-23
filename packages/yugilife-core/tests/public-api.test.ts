import { describe, expect, it } from "vitest"

import * as core from "../src"
import * as advanced from "../src/advanced"
import * as colorGrading from "../src/public/color-grading"

describe("public entry points", () => {
  it("keeps the root focused on common consumer APIs", () => {
    expect(Object.keys(core).sort()).toEqual([
      "MapAssetResolver",
      "TemplateValidationError",
      "collectLayerGroups",
      "collectPresetTargets",
      "createCardFromTemplate",
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
      "validateCardData",
      "validateCardTemplate",
      "validateColorPresetCollection",
      "validatePresentationOverrides",
      "validateTemplateManifest",
      "walkLayers",
    ])
  })

  it("exposes only deliberately supported specialized APIs", () => {
    expect(Object.keys(advanced)).toEqual([])
    expect(Object.keys(colorGrading).sort()).toEqual([
      "TextureCache",
      "applyColorPreset",
      "collectTexturePreparations",
      "decodePreparedTextures",
      "prepareTemplateTextures",
      "preparedTextureKey",
    ])
  })
})
