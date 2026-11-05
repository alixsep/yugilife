import { exportCardToImage } from "yugilife-core"

import { processArtworkMaskBlob } from "@/lib/pin-mask/artwork-mask-effects"

import { selectedArtworkMask as selectArtworkMask } from "../../build/editor/model/artwork-mask-state"
import { artworkEditorConfig, projectCardForRender } from "../../build/editor/model/editor-config"

import { inventoryPreviewExportOptions } from "./inventory-preview"

import type { EditorDocumentState } from "../../build/editor/model/editor-document"
import type { LoadedTemplateBundle } from "yugilife-templates"

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

export async function renderInventoryPreview(
  document: EditorDocumentState,
  bundle: LoadedTemplateBundle,
  processedMask: Blob | undefined,
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
      presentationOverrides: document.presentationOverrides,
      presetOverrides: document.presetOverrides,
      templateBundle: bundle,
    },
  )
}
