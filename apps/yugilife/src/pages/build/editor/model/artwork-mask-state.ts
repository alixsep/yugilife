import type { ArtworkMaskEditingState, EditorDocumentState } from "./editor-document"

/** A manual mask is valid only until its authored points change. */
export function selectedArtworkMask(mask: ArtworkMaskEditingState) {
  return mask.mode === "manual" ? mask.manualMask : mask.automaticMask
}

/**
 * Dot mode projects pins into a generated mask, so a document whose pins have changed has no mask
 * to render yet. Callers supply the template's artwork field name (`artworkEditorConfig().field`)
 * so this module stays independent of any one template's field vocabulary.
 */
export function artworkMaskPending(
  document: Pick<EditorDocumentState, "artworkMask" | "card">,
  artworkField: string,
) {
  return (
    !!document.card[artworkField] &&
    document.artworkMask.mode === "manual" &&
    !document.artworkMask.manualMask
  )
}

export function requireCompletedArtworkMask(
  document: Pick<EditorDocumentState, "artworkMask" | "card">,
  artworkField: string,
) {
  if (artworkMaskPending(document, artworkField)) {
    throw new Error(
      "Wait for the dot mask to finish, or retry it in the artwork preview before saving or exporting.",
    )
  }
}
