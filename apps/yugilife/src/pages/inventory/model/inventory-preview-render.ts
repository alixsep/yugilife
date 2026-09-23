import { exportCardToImage } from "yugilife-core"

import { processArtworkMaskBlob } from "@/lib/pin-mask/artwork-mask-effects"

import { selectedArtworkMask as selectArtworkMask } from "../../build/editor/model/artwork-mask-state"
import { artworkEditorConfig, projectCardForRender } from "../../build/editor/model/editor-config"

import { inventoryPreviewExportOptions } from "./inventory-preview"

import type { EditorDocumentState } from "../../build/editor/model/editor-document"
import type { PreparedTextures } from "yugilife-core"
import type { LoadedTemplateBundle } from "yugilife-templates"

/**
 * Processes a document's artwork mask with no reuse of an editor frame. The build editor keeps a
 * cached processed frame and passes it in; every other caller renders from the stored document
 * alone and reaches the same pixels the slower way.
 */
export async function processedInventoryMask(
  document: EditorDocumentState,
  bundle: LoadedTemplateBundle,
) {
  const config = artworkEditorConfig(bundle.template)
  const source = selectArtworkMask(document.artworkMask)
  if (!source) return undefined
  return processArtworkMaskBlob(
    source,
    config.maskField ? document.artworkMaskEffects[config.maskField] : undefined,
    config.maskChannel,
  )
}

/**
 * The single renderer for inventory previews. Saving, opening a migrated card, and the bulk refresh
 * all route through here, so a thumbnail cannot depend on which path produced it.
 */
export async function renderInventoryPreview(
  document: EditorDocumentState,
  bundle: LoadedTemplateBundle,
  processedMask: Blob | undefined,
  preparedTextures?: PreparedTextures,
) {
  return exportCardToImage(
    projectCardForRender(
      document.card,
      document.mode,
      document.artworkMask,
      bundle.template,
      processedMask,
    ),
    {
      ...inventoryPreviewExportOptions,
      layers: document.layers,
      preparedTextures,
      presentationOverrides: document.presentationOverrides,
      presetOverrides: document.presetOverrides,
      templateBundle: bundle,
    },
  )
}
