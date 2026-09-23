import type {
  AssetSourceMap,
  CardFieldDefinition,
  CardTemplate,
  CardTemplateBundle,
  ColorPresetCollection,
  LayerDefinition,
} from "../src"

export const NAME_FIELD: CardFieldDefinition = {
  defaultValue: "Test card",
  kind: "text",
  label: "Name",
  name: "name",
  required: true,
}

/**
 * Minimal valid template. Tests override only what they exercise, so schema additions land in one
 * place instead of every fixture.
 */
export function testTemplate(overrides: Partial<CardTemplate> = {}): CardTemplate {
  return {
    schemaVersion: 1,
    dimensions: { width: 100, height: 150 },
    cardFields: [NAME_FIELD],
    layers: [],
    ...overrides,
  }
}

export function testTemplateWithLayers(layers: readonly LayerDefinition[]): CardTemplate {
  return testTemplate({ layers })
}

export function testTemplateBundle(
  template: CardTemplate,
  assets: AssetSourceMap = {},
  colorPresets: ColorPresetCollection = {},
): CardTemplateBundle {
  return {
    assets,
    colorPresets,
    manifest: {
      assets: {},
      id: "card/test",
      kind: "card",
      name: "Test template",
      template: "template.json",
      version: "2026.01.01",
    },
    template,
  }
}
