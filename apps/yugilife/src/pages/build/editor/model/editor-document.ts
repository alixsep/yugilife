import type { CardData, LayerVisibility, PresentationOverrides, TemplateId } from "yugilife-core"

export type EditorMode = "automatic" | "advanced"

export interface EditorDocumentState {
  card: CardData
  /** Explicit values remain persisted while their semantic branch is dormant. */
  layers: LayerVisibility
  mode: EditorMode
  presetOverrides: Readonly<Record<string, string>>
  presentationOverrides: PresentationOverrides
  templateId: TemplateId
  templateVersion: string
}
