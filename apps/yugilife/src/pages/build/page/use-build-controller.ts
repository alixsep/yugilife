import { useCallback, useDeferredValue, useMemo, useState } from "react"

import {
  collectLayerGroups,
  defaultLayerVisibility,
  deriveCardSemantics,
  parseRichText,
  plainTextFromRichText,
  resolveCardPresentation,
  validateCardData,
} from "yugilife-core"
import { useShallow } from "zustand/react/shallow"

import { useCardCatalog } from "../card-catalog/model/use-card-catalog"
import { artworkMaskPending } from "../editor/model/artwork-mask-state"
import {
  editorCardFieldsForMode,
  editorColorPresets,
  editorTemplate,
  getActivePresentationOverrides,
  isAutomaticTextFitLayer,
  paintableTextStyles,
  presetTargetsForTemplate,
  projectCardForRender,
} from "../editor/model/editor-config"
import { useEditorStore } from "../editor/model/editor-store"
import { useReferenceImages } from "../references/reference-library"
import { templateBundleMatchesVersion } from "../templates/template-storage"

import { useDownloads } from "./downloads"
import { useArtworkMaskPreview } from "./use-artwork-mask-preview"
import { useCardExport } from "./use-card-export"
import { useInventorySession } from "./use-inventory-session"
import { useReferenceSettings } from "./use-reference-settings"
import { useTemplateActivation } from "./use-template-activation"
import { useTemplateDocuments } from "./use-template-documents"

import type { ActivePresentationOverride } from "../editor/model/editor-config"
import type { EditorDocumentState } from "../editor/model/editor-document"
import type { CardFieldValue } from "yugilife-core"

function useEditorDocument(): EditorDocumentState {
  return useEditorStore(
    useShallow((state) => ({
      artworkMask: state.artworkMask,
      artworkMaskEffects: state.artworkMaskEffects,
      card: state.card,
      layers: state.layers,
      mode: state.mode,
      presetOverrides: state.presetOverrides,
      presentationOverrides: state.presentationOverrides,
      templateId: state.templateId,
      templateVersion: state.templateVersion,
    })),
  )
}

function useEditorActions() {
  return useEditorStore(
    useShallow((state) => ({
      applyCardPatchWithArtworkMask: state.applyCardPatchWithArtworkMask,
      clearAllPresentationOverrides: state.clearAllPresentationOverrides,
      clearArtworkMaskEffects: state.clearArtworkMaskEffects,
      clearArtworkTransform: state.clearArtworkTransform,
      clearLayerMaskOverride: state.clearLayerMaskOverride,
      clearLayerOverride: state.clearLayerOverride,
      clearPresetOverride: state.clearPresetOverride,
      clearTextFitProfile: state.clearTextFitProfile,
      clearTextTypography: state.clearTextTypography,
      completeArtworkMask: state.completeArtworkMask,
      replaceDocument: state.replaceDocument,
      reset: state.reset,
      setAllLayers: state.setAllLayers,
      setArtworkMask: state.setArtworkMask,
      setArtworkMaskEffects: state.setArtworkMaskEffects,
      setArtworkTransform: state.setArtworkTransform,
      setField: state.setField,
      setLayer: state.setLayer,
      setMode: state.setMode,
      setPresetOverride: state.setPresetOverride,
      setTemplateIdentity: state.setTemplateIdentity,
      setTextFitProfile: state.setTextFitProfile,
      setTextTypography: state.setTextTypography,
    })),
  )
}

export function useBuildController(cardId: string) {
  const currentDocument = useEditorDocument()
  const actions = useEditorActions()
  const { artworkMask, artworkMaskEffects, card, layers, mode, presetOverrides } = currentDocument
  const { presentationOverrides } = currentDocument
  const [inventoryBusy, setInventoryBusy] = useState(true)
  const [debugLoggingEnabled, setDebugLoggingEnabled] = useState(false)
  const [showActiveOverrides, setShowActiveOverrides] = useState(false)
  const cardCatalog = useCardCatalog()
  const referenceLibrary = useReferenceImages()
  const referenceSettings = useReferenceSettings()
  const download = useDownloads()

  const activation = useTemplateActivation({
    inventoryBusy,
    setTemplateIdentity: actions.setTemplateIdentity,
    storedTemplateId: currentDocument.templateId,
  })
  const templateDocuments = useTemplateDocuments(activation, download)
  const { templateBundle } = activation
  const activeEditorTemplate = templateBundle?.template ?? editorTemplate
  const activeEditorColorPresets = templateBundle?.colorPresets ?? editorColorPresets

  // The editor document outlives the route; process masks only once the requested card hydrated.
  const maskPreview = useArtworkMaskPreview({
    artwork: card.artwork,
    artworkMask,
    artworkMaskEffects,
    ready:
      !inventoryBusy &&
      templateBundleMatchesVersion(
        templateBundle,
        currentDocument.templateId,
        currentDocument.templateVersion,
      ),
    template: activeEditorTemplate,
  })

  const { openTemplate, setSelectedTemplateId } = activation
  const onCardOpened = useCallback(
    (document: EditorDocumentState) => setSelectedTemplateId(document.templateId),
    [setSelectedTemplateId],
  )
  const inventory = useInventorySession({
    cardId,
    currentDocument,
    onCardOpened,
    onCardOpening: activation.deactivate,
    processedMaskForDocument: maskPreview.processedMaskForDocument,
    replaceDocument: actions.replaceDocument,
    setInventoryBusy,
    templateBundle,
  })

  const deferredCard = useDeferredValue(card)
  const plainCardName = useMemo(
    () => plainTextFromRichText(parseRichText(deferredCard.name).document),
    [deferredCard.name],
  )
  const cardExport = useCardExport({
    currentDocument,
    download,
    onDocumentImported: (document) => {
      actions.replaceDocument(document)
      openTemplate(document.templateId)
    },
    plainCardName,
    processedMaskForDocument: maskPreview.processedMaskForDocument,
    syncTemplateStorageMode: activation.syncTemplateStorageMode,
    template: activeEditorTemplate,
    templateBundle,
  })

  // Project artwork and mask together so a new mask is never paired with an older artwork.
  const projectedRenderCard = useMemo(
    () =>
      projectCardForRender(
        card,
        mode,
        artworkMask,
        activeEditorTemplate,
        maskPreview.processedArtworkMask ?? maskPreview.selectedArtworkMask,
      ),
    [
      activeEditorTemplate,
      artworkMask,
      card,
      mode,
      maskPreview.processedArtworkMask,
      maskPreview.selectedArtworkMask,
    ],
  )
  const renderCardData = useDeferredValue(projectedRenderCard)
  const cardFields = useMemo(
    () => editorCardFieldsForMode(deferredCard, mode, activeEditorTemplate),
    [activeEditorTemplate, deferredCard, mode],
  )
  const automaticCardFields = useMemo(
    () => editorCardFieldsForMode(deferredCard, "automatic", activeEditorTemplate),
    [activeEditorTemplate, deferredCard],
  )
  const activeLayerGroups = useMemo(
    () =>
      [...collectLayerGroups(activeEditorTemplate)]
        .reverse()
        .map((group) => ({ ...group, layers: [...group.layers].reverse() })),
    [activeEditorTemplate],
  )
  const activeDefaultLayerVisibility = useMemo(
    () => defaultLayerVisibility(activeEditorTemplate),
    [activeEditorTemplate],
  )
  const activePresetTargets = useMemo(
    () => presetTargetsForTemplate(activeEditorTemplate, activeEditorColorPresets),
    [activeEditorColorPresets, activeEditorTemplate],
  )
  const semantics = useMemo(
    () => deriveCardSemantics(renderCardData, activeEditorTemplate),
    [activeEditorTemplate, renderCardData],
  )
  const defaultPresentation = useMemo(
    () => resolveCardPresentation(activeEditorTemplate, semantics),
    [activeEditorTemplate, semantics],
  )
  const presentation = useMemo(
    () => resolveCardPresentation(activeEditorTemplate, semantics, presentationOverrides),
    [activeEditorTemplate, presentationOverrides, semantics],
  )
  const activeOverrides = useMemo(
    () =>
      getActivePresentationOverrides(
        layers,
        presetOverrides,
        presentationOverrides,
        presentation,
        activeEditorTemplate,
        activeEditorColorPresets,
        artworkMaskEffects,
      ),
    [
      activeEditorColorPresets,
      activeEditorTemplate,
      layers,
      presentation,
      presentationOverrides,
      presetOverrides,
      artworkMaskEffects,
    ],
  )
  const fittedText = useMemo(
    () =>
      Object.values(presentation.text).filter(
        ({ layerId, typography }) =>
          !isAutomaticTextFitLayer(layerId, activeEditorTemplate) &&
          (typography.fitProfiles?.length ?? 0) > 0,
      ),
    [activeEditorTemplate, presentation.text],
  )
  const paintableText = useMemo(
    () => paintableTextStyles(layers, presentation, activeEditorTemplate),
    [activeEditorTemplate, layers, presentation],
  )
  const compressibleText = useMemo(
    () =>
      Object.values(presentation.text).filter(
        ({ typography }) =>
          typography.maxAutoCompressionX !== undefined ||
          typography.fitProfiles?.some(
            ({ maxAutoCompressionX }) => maxAutoCompressionX !== undefined,
          ) === true,
      ),
    [presentation.text],
  )

  function selectTemplate(templateId: string) {
    templateDocuments.closeEditor()
    activation.selectTemplate(templateId)
  }

  async function removeSelectedTemplate() {
    if (await activation.removeSelectedTemplate()) templateDocuments.closeEditor()
  }

  function resetEditor() {
    actions.reset()
    if (templateBundle) {
      actions.setTemplateIdentity(templateBundle.manifest.id, templateBundle.manifest.version)
    }
  }

  function applyCatalogCardPatch(
    patch: Readonly<Record<string, CardFieldValue>>,
    nextArtworkMask: EditorDocumentState["artworkMask"],
  ) {
    validateCardData({ ...card, ...patch }, activeEditorTemplate)
    actions.applyCardPatchWithArtworkMask(patch, nextArtworkMask)
  }

  function clearActiveOverride(override: ActivePresentationOverride) {
    switch (override.kind) {
      case "artwork-transform":
        return actions.clearArtworkTransform(override.transformId)
      case "artwork-mask-effects":
        return actions.clearArtworkMaskEffects(override.maskField)
      case "layer":
        return actions.clearLayerOverride(override.layerId)
      case "layer-mask":
        return actions.clearLayerMaskOverride(override.layerId)
      case "preset":
        return actions.clearPresetOverride(override.target)
      case "text-fit":
        return actions.clearTextFitProfile(override.layerId, override.styleId)
      case "text-typography":
        return actions.clearTextTypography(override.layerId, override.styleId)
    }
  }

  return {
    ...referenceSettings,
    ...cardExport,
    ...inventory,
    activeDefaultLayerVisibility,
    activeEditorTemplate,
    activeLayerGroups,
    activeOverrides,
    activePresetTargets,
    applyCatalogCardPatch,
    applyTemplateEdit: templateDocuments.applyTemplateEdit,
    artworkEffectsError: maskPreview.artworkEffectsError,
    artworkMask,
    artworkMaskEffects,
    artworkMaskPending: artworkMaskPending(currentDocument, maskPreview.artworkConfig.field),
    automaticCardFields,
    beginTemplateEditing: templateDocuments.beginTemplateEditing,
    cancelTemplateEdit: templateDocuments.cancelTemplateEdit,
    card,
    cardCatalog,
    cardFields,
    clearActiveOverride,
    clearAllPresentationOverrides: actions.clearAllPresentationOverrides,
    completeArtworkMask: actions.completeArtworkMask,
    compressibleText,
    debugLoggingEnabled,
    defaultPresentation,
    exportTemplate: templateDocuments.exportTemplate,
    fittedText,
    getProcessedArtworkMaskPixels: maskPreview.getProcessedArtworkMaskPixels,
    importTemplate: templateDocuments.importTemplate,
    inventoryBusy,
    layers,
    loadSelectedTemplate: activation.loadSelectedTemplate,
    mode,
    originStorage: activation.originStorage,
    paintableText,
    plainCardName,
    presentation,
    presentationOverrides,
    presetOverrides,
    processedArtworkBusy: maskPreview.processedArtworkBusy,
    processedArtworkMask: maskPreview.processedArtworkMask,
    processedArtworkRevision: maskPreview.processedArtworkRevision,
    reference: referenceLibrary.selectedReference,
    referenceLibrary,
    removeSelectedTemplate,
    renderCardData,
    resetEditor,
    retryArtworkEffects: maskPreview.retryArtworkEffects,
    selectTemplate,
    selectedTemplateId: activation.selectedTemplateId,
    selectedTemplateIsUser: activation.selectedTemplateIsUser,
    selectedTemplateName: activation.selectedTemplateName,
    selectedTemplateVersion: activation.selectedTemplateVersion,
    setAllLayers: actions.setAllLayers,
    setArtworkMask: actions.setArtworkMask,
    setArtworkMaskEffects: actions.setArtworkMaskEffects,
    setArtworkTransform: actions.setArtworkTransform,
    setDebugLoggingEnabled,
    setField: actions.setField,
    setLayer: actions.setLayer,
    setMode: actions.setMode,
    setPresetOverride: actions.setPresetOverride,
    setShowActiveOverrides,
    setTemplateDraft: templateDocuments.setTemplateDraft,
    setTextFitProfile: actions.setTextFitProfile,
    setTextTypography: actions.setTextTypography,
    showActiveOverrides,
    storedTemplate: activation.storedTemplate,
    storedTemplates: activation.storedTemplates,
    templateBundle,
    templateBundleMatchesSelection: activation.templateBundleMatchesSelection,
    templateCacheBytes: activation.templateCacheBytes,
    templateDocumentBusy: templateDocuments.templateDocumentBusy,
    templateDocumentError: templateDocuments.templateDocumentError,
    templateDraft: templateDocuments.templateDraft,
    templateEditorOpen: templateDocuments.templateEditorOpen,
    templateLoadError: activation.templateLoadError,
    templateLoadPaused: activation.templateLoadPaused,
    templateLoadProgress: activation.templateLoadProgress,
    templateLoading: activation.templateLoading,
    templateReady: activation.templateReady,
    templateStorageError: activation.templateStorageError,
    templateStorageMode: activation.templateStorageMode,
    templateTransferAvailable: templateDocuments.templateTransferAvailable,
  }
}
