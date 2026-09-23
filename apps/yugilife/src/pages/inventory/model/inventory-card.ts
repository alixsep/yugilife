import type { EditorDocumentState } from "../../build/editor/model/editor-document"

export interface InventoryCard {
  createdAt: number
  document: EditorDocumentState
  id: string
  revision: number
  title: string
  updatedAt: number
}

export interface InventoryCardSummary extends Omit<InventoryCard, "document"> {
  templateId: EditorDocumentState["templateId"]
  templateVersion: string
}

export interface InventoryCardPreview {
  cardId: string
  cardRevision: number
  image: Blob
}
