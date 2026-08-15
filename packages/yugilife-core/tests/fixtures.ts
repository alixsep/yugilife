import type {
  AssetSourceMap,
  CardData,
  CardFieldDefinition,
  CardTemplate,
  CardTemplateBundle,
  ColorPresetCollection,
  LayerDefinition,
} from "../src"

export const SAMPLE_CARD: CardData = {
  name: "Sample Card Title",
  attribute: "DARK",
  cardVariant: "effect",
  level: 8,
  spellTrapType: "normal",
  types: ["Dragon", "Effect"],
  description: ["A test card rendered through a synthetic template fixture."],
  attack: "2500",
  defense: "2000",
  cardCode: "CARD-EN001",
  serialNumber: "12345678",
  edition: "1st Edition",
  copyright: "TEST",
}

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
