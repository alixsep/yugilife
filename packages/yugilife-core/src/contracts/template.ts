export type TemplateKind = "card" | "box" | "playmat-board" | "playmat-field"
export type TemplateStatus = "supported" | "experimental" | "disabled"
export type TemplateId = string
export type SemanticAssetId = string

export interface TemplateIdentity {
  id: TemplateId
  kind: TemplateKind
  name: string
  version: string
}

export interface TemplateManifest extends TemplateIdentity {
  assets: Readonly<Record<SemanticAssetId, string>>
  colorPresets?: string
  status?: TemplateStatus
  template: string
  templateDependencies?: readonly TemplateId[]
}

export interface CardDimensions {
  width: number
  height: number
}

export interface Region {
  x: number
  y: number
  width: number
  height: number
}
