// yugilife-core: template-driven card rendering, validation, semantics, presentation, and rich
// text. The implementation is the Rust core (crates/yugilife-core) compiled to WebAssembly;
// importing this module loads it once.

export type * from "./contracts/index.js"
export { createLayerSourceFieldResolver } from "./layer-source-fields"
export type { LayerVisit } from "./layer-tree"
export {
  collectLayerGroups,
  collectPresetTargets,
  defaultLayerVisibility,
  defaultPresetForTarget,
  flattenDrawableLayers,
  flattenLayers,
  isLayerVisible,
  textTypographies,
  walkLayers,
} from "./layer-tree"
export { matchesPresentationGate, resolveCardPresentation } from "./presentation"
export { resolveRasterOutputDimensions } from "./raster-output"
export { exportCardToImage, exportCardToPng, exportCardToSvg, renderCard } from "./render/render"
export {
  graphemeCount,
  hasLeadingAuthoredLineFitSplit,
  parseRichText,
  parseRichTextLength,
  parseRichTextScale,
  plainTextFromRichText,
  richTextHasFormatting,
  richTextLineLengths,
} from "./rich-text"
export { deriveCardSemantics, matchesSemanticCondition } from "./semantics"
export { compareTemplateVersions, isTemplateVersion } from "./template-version"
export {
  createCardFromTemplate,
  TemplateValidationError,
  validateCardData,
  validateCardTemplate,
  validateColorPresetCollection,
  validatePresentationOverrides,
  validateTemplateManifest,
} from "./validation"
