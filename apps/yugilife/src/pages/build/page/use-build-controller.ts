import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react"

import { useNavigate } from "react-router"
import {
  collectLayerGroups,
  defaultLayerVisibility,
  deriveCardSemantics,
  exportCardToImage,
  exportCardToSvg,
  parseRichText,
  plainTextFromRichText,
  resolveCardPresentation,
  resolveRasterOutputDimensions,
  validateCardData,
} from "yugilife-core"
import { DEFAULT_TEMPLATE_ID, getOfficialTemplate, TEMPLATE_CATALOG } from "yugilife-templates"

import {
  disposeArtworkMaskWorker,
  hasArtworkMaskEffects,
  processArtworkMaskBlob,
  processArtworkMaskSource,
} from "@/lib/pin-mask/artwork-mask-effects"
import { isQuickSelectionWorkerAbortError } from "@/lib/pin-mask/quick-selection-worker-client"

import {
  migrateInventoryCardDocument,
  migrateInventoryCardToCurrentTemplate,
} from "../../inventory/model/inventory-card-migration"
import { inventoryPreviewMatchesCard } from "../../inventory/model/inventory-preview"
import {
  processedInventoryMask,
  renderInventoryPreview,
} from "../../inventory/model/inventory-preview-render"
import { writeActiveInventoryCardId } from "../../inventory/persistence/inventory-settings"
import {
  createInventoryCard,
  getInventoryStorageMode,
  listInventoryCards,
  readInventoryCard,
  readInventoryPreview,
  saveInventoryCardSnapshot,
} from "../../inventory/persistence/inventory-storage"
import { useCardCatalog } from "../card-catalog/model/use-card-catalog"
import {
  canPresentArtworkMaskFrame,
  isArtworkMaskFrameCurrent,
} from "../editor/model/artwork-mask-frame"
import {
  artworkMaskPending,
  requireCompletedArtworkMask,
  selectedArtworkMask as selectArtworkMask,
} from "../editor/model/artwork-mask-state"
import {
  artworkEditorConfig,
  editorCardFieldsForMode,
  editorColorPresets,
  editorTemplate,
  editorTemplateVersion,
  getActivePresentationOverrides,
  isAutomaticTextFitLayer,
  paintableTextStyles,
  presetTargetsForTemplate,
  projectCardForRender,
} from "../editor/model/editor-config"
import {
  createInitialEditorDocument,
  editorSelectors,
  useEditorStore,
} from "../editor/model/editor-store"
import {
  maximumEditorDocumentBytes,
  parseEditorDocument,
  serializeEditorDocument,
} from "../editor/persistence/editor-document-io"
import { useReferenceImages } from "../references/reference-library"
import {
  readComparisonMode,
  readReferenceOpacity,
  writeComparisonMode,
  writeReferenceOpacity,
} from "../references/reference-settings"
import {
  acquirePreparedTextures,
  preparedTexturesForBundle,
  preparedTexturesSettled,
} from "../templates/prepare-template-textures"
import {
  applyTemplateSourceDocument,
  makeUserTemplateCopy,
  maximumTemplateDocumentBytes,
  parseTemplateBundleDocument,
  parseTemplateSourceDocument,
  serializeTemplateBundleDocument,
  serializeTemplateSourceDocument,
  templateEditorCompatibility,
  validateTemplateBundle,
} from "../templates/template-document-io"
import {
  deleteStoredTemplate,
  getTemplateStorageMode,
  readStoredTemplate,
  readTemplateStorageSnapshot,
  storeTemplate,
  templateBundleMatchesVersion,
} from "../templates/template-storage"

import type { ArtworkMaskFrameIdentity } from "../editor/model/artwork-mask-frame"
import type { ActivePresentationOverride } from "../editor/model/editor-config"
import type { EditorDocumentState } from "../editor/model/editor-document"
import type {
  ActivePreparedTextures,
  TemplateActivationProgress,
} from "../templates/prepare-template-textures"
import type {
  OriginStorageEstimate,
  StoredTemplateRecord,
  TemplateStorageMode,
} from "../templates/template-storage"
import type { ProcessedArtworkMaskPixels } from "@/lib/pin-mask/artwork-mask-effects"
import type { ChangeEvent } from "react"
import type {
  CardFieldValue,
  CardTemplateBundle,
  RasterImageFormat,
  RasterOutputSize,
} from "yugilife-core"

export type ExportFormat = RasterImageFormat | "svg"
export type RasterSizeChoice = "0.5" | "1" | "2" | "4" | "8" | "height" | "width"

function rasterSizeForChoice(
  choice: RasterSizeChoice,
  customDimension: string,
): RasterOutputSize | undefined {
  if (choice === "1") return undefined
  if (choice === "width" || choice === "height") {
    const dimension = Number(customDimension)
    if (!Number.isSafeInteger(dimension) || dimension <= 0) return undefined
    return choice === "width" ? { width: dimension } : { height: dimension }
  }
  return { scale: Number(choice) }
}

export const editorTemplateCatalog = TEMPLATE_CATALOG.filter(({ id }) => id === DEFAULT_TEMPLATE_ID)

function safeFileName(name: string) {
  const normalized = name
    .trim()
    .replaceAll(/[^a-zA-Z0-9_-]+/g, "-")
    .replaceAll(/^-|-$/g, "")
  return normalized || "yugilife-card"
}

function editorValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (left instanceof Blob || right instanceof Blob) return false
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => editorValuesEqual(value, right[index]))
    )
  }
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) {
    return false
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  const rightKeys = Object.keys(rightRecord)
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) => key in rightRecord && editorValuesEqual(leftRecord[key], rightRecord[key]),
    )
  )
}

function artworkMaskEffectsKey(effects: { antiAlias?: boolean; glow?: number } | undefined) {
  return `${effects?.antiAlias === true ? "1" : "0"}:${effects?.glow ?? 0}`
}

export function editorDocumentsEqual(left: EditorDocumentState, right: EditorDocumentState) {
  return editorValuesEqual(left, right)
}

export function useBuildController(cardId: string) {
  const navigate = useNavigate()
  const card = useEditorStore(editorSelectors.card)
  const artworkMask = useEditorStore(editorSelectors.artworkMask)
  const artworkMaskEffects = useEditorStore(editorSelectors.artworkMaskEffects)
  const applyCardPatchWithArtworkMask = useEditorStore(
    editorSelectors.applyCardPatchWithArtworkMask,
  )
  const layers = useEditorStore(editorSelectors.layers)
  const mode = useEditorStore(editorSelectors.mode)
  const presetOverrides = useEditorStore(editorSelectors.presetOverrides)
  const presentationOverrides = useEditorStore(editorSelectors.presentationOverrides)
  const storedTemplateId = useEditorStore(editorSelectors.templateId)
  const storedTemplateVersion = useEditorStore(editorSelectors.templateVersion)
  const clearAllPresentationOverrides = useEditorStore(
    editorSelectors.clearAllPresentationOverrides,
  )
  const clearArtworkMaskEffects = useEditorStore(editorSelectors.clearArtworkMaskEffects)
  const clearArtworkTransform = useEditorStore(editorSelectors.clearArtworkTransform)
  const clearLayerMaskOverride = useEditorStore(editorSelectors.clearLayerMaskOverride)
  const clearLayerOverride = useEditorStore(editorSelectors.clearLayerOverride)
  const clearPresetOverride = useEditorStore(editorSelectors.clearPresetOverride)
  const clearTextFitProfile = useEditorStore(editorSelectors.clearTextFitProfile)
  const clearTextTypography = useEditorStore(editorSelectors.clearTextTypography)
  const reset = useEditorStore(editorSelectors.reset)
  const replaceDocument = useEditorStore(editorSelectors.replaceDocument)
  const setAllLayers = useEditorStore(editorSelectors.setAllLayers)
  const setArtworkMaskEffects = useEditorStore(editorSelectors.setArtworkMaskEffects)
  const setArtworkTransform = useEditorStore(editorSelectors.setArtworkTransform)
  const setArtworkMask = useEditorStore(editorSelectors.setArtworkMask)
  const completeArtworkMask = useEditorStore(editorSelectors.completeArtworkMask)
  const setField = useEditorStore(editorSelectors.setField)
  const setLayer = useEditorStore(editorSelectors.setLayer)
  const setMode = useEditorStore(editorSelectors.setMode)
  const setPresetOverride = useEditorStore(editorSelectors.setPresetOverride)
  const setTextFitProfile = useEditorStore(editorSelectors.setTextFitProfile)
  const setTextTypography = useEditorStore(editorSelectors.setTextTypography)
  const setTemplateIdentity = useEditorStore(editorSelectors.setTemplateIdentity)
  const [selectedTemplateIdOverride, setSelectedTemplateId] = useState<string>()
  const [templateBundle, setTemplateBundle] = useState<CardTemplateBundle>()
  const [activeTextures, setActiveTextures] = useState<ActivePreparedTextures>()
  const activeTexturesRef = useRef<ActivePreparedTextures | undefined>(undefined)
  const [templateLoadError, setTemplateLoadError] = useState<string>()
  const [templateLoadPaused, setTemplateLoadPaused] = useState(false)
  const [templateLoadProgress, setTemplateLoadProgress] = useState<TemplateActivationProgress>()
  const [templateLoading, setTemplateLoading] = useState(false)
  const templateLoadController = useRef<AbortController | undefined>(undefined)
  const automaticTemplateRestore = useRef<string | undefined>(undefined)
  const [storedTemplates, setStoredTemplates] = useState<readonly StoredTemplateRecord[]>([])
  const [templateStorageReady, setTemplateStorageReady] = useState(false)
  const [originStorage, setOriginStorage] = useState<OriginStorageEstimate>({})
  const [preparedTextureBytes, setPreparedTextureBytes] = useState(0)
  const [templateStorageMode, setTemplateStorageMode] =
    useState<TemplateStorageMode>(getTemplateStorageMode())
  const [templateStorageError, setTemplateStorageError] = useState<string>()
  const [templateDocumentBusy, setTemplateDocumentBusy] = useState(false)
  const [templateDocumentError, setTemplateDocumentError] = useState<string>()
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false)
  const [templateDraft, setTemplateDraft] = useState("")
  const [comparisonMode, setComparisonMode] = useState(readComparisonMode)
  const [documentTransferError, setDocumentTransferError] = useState<string>()
  const [documentTransferBusy, setDocumentTransferBusy] = useState(false)
  const [exportError, setExportError] = useState<string>()
  const [exportFormat, setExportFormat] = useState<ExportFormat>("png")
  const [exporting, setExporting] = useState(false)
  const [rasterBackground, setRasterBackground] = useState("#ffffff")
  const [rasterCustomDimension, setRasterCustomDimension] = useState(() =>
    String(editorTemplate.dimensions.width),
  )
  const [rasterQuality, setRasterQuality] = useState(92)
  const [rasterSizeChoice, setRasterSizeChoice] = useState<RasterSizeChoice>("1")
  const [debugLoggingEnabled, setDebugLoggingEnabled] = useState(false)
  const [showActiveOverrides, setShowActiveOverrides] = useState(false)
  const [referenceOpacity, setReferenceOpacity] = useState(readReferenceOpacity)
  const [settingsStorageError, setSettingsStorageError] = useState<string>()
  const [inventoryBusy, setInventoryBusy] = useState(true)
  const [inventoryError, setInventoryError] = useState<string>()
  const [inventorySaveError, setInventorySaveError] = useState<string>()
  const [savingCard, setSavingCard] = useState(false)
  const [savedDocument, setSavedDocument] = useState<EditorDocumentState>()
  const [newCardBusy, setNewCardBusy] = useState(false)
  const [newCardError, setNewCardError] = useState<string>()
  const inventoryCard = useRef<Awaited<ReturnType<typeof readInventoryCard>>>(undefined)
  /**
   * Set when an opened card still owes storage a commit: either its document was migrated in memory
   * or its preview is missing. The commit waits for the template bundle, because the card and its
   * rendered thumbnail are written in one transaction.
   *
   * This is state rather than a ref because the card load and the bundle load race: whichever
   * finishes last must be able to start the commit, and only a render can observe both.
   */
  const [pendingSnapshotCardId, setPendingSnapshotCardId] = useState<string>()
  /**
   * The card a commit has already been started for. Clearing the trigger from inside the effect
   * would re-run its own cleanup and cancel the write it just started, so re-entry is guarded here
   * instead. Opening a card resets it, which is what lets a failed commit be retried.
   */
  const startedSnapshotCardId = useRef<string>(undefined)
  /** Invalidates an in-flight commit, so a superseded one cannot publish or unstick the save flag. */
  const snapshotCommitToken = useRef(0)
  const cardCatalog = useCardCatalog()

  const persistedSelectedTemplateId = storedTemplateId.startsWith("user/")
    ? storedTemplateId
    : DEFAULT_TEMPLATE_ID
  const requestedSelectedTemplateId = selectedTemplateIdOverride ?? persistedSelectedTemplateId
  const selectedTemplateId =
    templateStorageReady &&
    requestedSelectedTemplateId.startsWith("user/") &&
    !storedTemplates.some(
      ({ id, source }) => id === requestedSelectedTemplateId && source === "user",
    )
      ? DEFAULT_TEMPLATE_ID
      : requestedSelectedTemplateId
  // Keep download URLs alive until unmount so cleanup cannot race the browser consuming them.
  const downloadUrls = useRef<string[]>([])
  const referenceLibrary = useReferenceImages()
  const activeEditorTemplate = templateBundle?.template ?? editorTemplate
  const rasterOutputDimensions = useMemo(() => {
    const size = rasterSizeForChoice(rasterSizeChoice, rasterCustomDimension)
    if ((rasterSizeChoice === "width" || rasterSizeChoice === "height") && !size) {
      return undefined
    }
    try {
      return resolveRasterOutputDimensions(activeEditorTemplate.dimensions, size)
    } catch {
      return undefined
    }
  }, [activeEditorTemplate.dimensions, rasterCustomDimension, rasterSizeChoice])
  const activeEditorColorPresets = templateBundle?.colorPresets ?? editorColorPresets
  const activeArtworkConfig = useMemo(
    () => artworkEditorConfig(activeEditorTemplate),
    [activeEditorTemplate],
  )
  // The Zustand document outlives the Build route. Re-entering the editor must not process that
  // previous in-memory document before the requested inventory card and its exact template have
  // finished hydrating, or the same persisted mask is derived once before replacement and again
  // afterwards with a new Blob identity.
  const artworkMaskProcessingReady =
    !inventoryBusy &&
    templateBundleMatchesVersion(templateBundle, storedTemplateId, storedTemplateVersion)
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
  const deferredCard = useDeferredValue(card)
  const currentMaskSource = selectArtworkMask(artworkMask)
  const [completedMaskSource, setCompletedMaskSource] = useState<{
    artwork: Blob
    source: Blob
    channel: "alpha" | "luminance"
    mode: "automatic" | "manual"
  }>()
  // Only the live preview may bridge a pending pin edit with the previous completed source.
  // Durable operations always use selectedArtworkMask plus the completion guard.
  const selectedArtworkMask =
    currentMaskSource ??
    (artworkMask.mode === "manual" &&
    completedMaskSource?.mode === "manual" &&
    completedMaskSource.artwork === card.artwork &&
    completedMaskSource.channel === activeArtworkConfig.maskChannel
      ? completedMaskSource.source
      : undefined)
  if (
    currentMaskSource &&
    card.artwork instanceof Blob &&
    (completedMaskSource?.source !== currentMaskSource ||
      completedMaskSource.artwork !== card.artwork ||
      completedMaskSource.mode !== artworkMask.mode ||
      completedMaskSource.channel !== activeArtworkConfig.maskChannel)
  ) {
    setCompletedMaskSource({
      artwork: card.artwork,
      source: currentMaskSource,
      mode: artworkMask.mode,
      channel: activeArtworkConfig.maskChannel,
    })
  } else if (
    !currentMaskSource &&
    (!card.artwork || artworkMask.mode === "automatic") &&
    completedMaskSource
  ) {
    setCompletedMaskSource(undefined)
  }
  const activeArtworkMaskEffects = activeArtworkConfig.maskField
    ? artworkMaskEffects[activeArtworkConfig.maskField]
    : undefined
  const [processedArtwork, setProcessedArtwork] = useState<
    ArtworkMaskFrameIdentity & {
      blob?: Blob
    }
  >()
  // This is the last completed presentation frame. It may intentionally lag the current effects
  // key while the worker computes a newer frame. Save/export may reuse it only after matching the
  // source, channel, and effects exactly against their own document snapshot.
  // Native pixels stay in the worker. The ref holds only its bounded workspace preview; React
  // state carries the native PNG Blob and a revision, never inspectable pixel buffers.
  const processedArtworkPixelsRef = useRef<
    | (ArtworkMaskFrameIdentity & {
        pixels: ProcessedArtworkMaskPixels
      })
    | undefined
  >(undefined)
  const [processedArtworkRevision, setProcessedArtworkRevision] = useState(0)
  const [artworkEffectsError, setArtworkEffectsError] = useState<string>()
  const [artworkEffectsRetry, setArtworkEffectsRetry] = useState(0)
  const [failedArtworkMaskFrame, setFailedArtworkMaskFrame] = useState<ArtworkMaskFrameIdentity>()
  const artworkEffectsKey = useMemo(
    () => artworkMaskEffectsKey(activeArtworkMaskEffects),
    [activeArtworkMaskEffects],
  )
  const artworkMaskEffectsActive = hasArtworkMaskEffects(activeArtworkMaskEffects)
  const requestedArtworkMaskFrame = useMemo<ArtworkMaskFrameIdentity | undefined>(
    () =>
      artworkMaskProcessingReady &&
      artworkMaskEffectsActive &&
      card.artwork instanceof Blob &&
      selectedArtworkMask
        ? {
            artwork: card.artwork,
            source: selectedArtworkMask,
            mode: artworkMask.mode,
            channel: activeArtworkConfig.maskChannel,
            effectsKey: artworkEffectsKey,
          }
        : undefined,
    [
      artworkMaskProcessingReady,
      artworkMaskEffectsActive,
      card.artwork,
      selectedArtworkMask,
      artworkMask.mode,
      activeArtworkConfig.maskChannel,
      artworkEffectsKey,
    ],
  )
  // Derived from intent, not a later effect/microtask: the raw-mask -> effects handoff has no
  // render in which a replacement is pending but the workspace thinks processing is complete.
  const processedArtworkBusy =
    !!requestedArtworkMaskFrame &&
    !isArtworkMaskFrameCurrent(processedArtwork, requestedArtworkMaskFrame) &&
    !isArtworkMaskFrameCurrent(failedArtworkMaskFrame, requestedArtworkMaskFrame)
  const processedArtworkCanPreview = canPresentArtworkMaskFrame(
    processedArtwork,
    requestedArtworkMaskFrame,
  )
  const processedArtworkMask =
    processedArtworkCanPreview && processedArtwork ? processedArtwork.blob : undefined
  const getProcessedArtworkMaskPixels = useCallback(() => {
    // Keep the last completed frame visible while a newer effects request is in flight. The
    // target effects still gate this fallback, so disabling all effects immediately returns to
    // the source mask instead of accidentally retaining an old glow.
    const current = processedArtworkPixelsRef.current
    if (!current || !canPresentArtworkMaskFrame(current, requestedArtworkMaskFrame))
      return undefined
    return current.pixels
  }, [requestedArtworkMaskFrame])
  const processedMaskRequestRef = useRef(0)
  useEffect(() => {
    const requestId = processedMaskRequestRef.current + 1
    processedMaskRequestRef.current = requestId
    const source = selectedArtworkMask
    const controller = new AbortController()
    const effects = activeArtworkMaskEffects
    const identity = requestedArtworkMaskFrame
    // Keep the previous completed frame while this intent is processed. Presentation accepts it
    // only within the same artwork/mode/channel; save/export still require exact source/effects.
    if (!identity || !source || effects === undefined || !hasArtworkMaskEffects(effects)) {
      return () => controller.abort()
    }
    if (isArtworkMaskFrameCurrent(processedArtworkPixelsRef.current, identity)) {
      return () => controller.abort()
    }
    setArtworkEffectsError(undefined)
    void processArtworkMaskSource(
      source,
      effects,
      activeArtworkConfig.maskChannel,
      controller.signal,
    )
      .then((processed) => {
        if (controller.signal.aborted || processedMaskRequestRef.current !== requestId) return
        const blob = processed.blob
        if (!controller.signal.aborted && processedMaskRequestRef.current === requestId) {
          processedArtworkPixelsRef.current = {
            ...identity,
            pixels: processed,
          }
          setProcessedArtwork({
            ...identity,
            blob,
          })
          setFailedArtworkMaskFrame(undefined)
          setProcessedArtworkRevision((revision) => revision + 1)
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && processedMaskRequestRef.current === requestId) {
          setFailedArtworkMaskFrame(identity)
          if (!isQuickSelectionWorkerAbortError(reason)) {
            setArtworkEffectsError(
              reason instanceof Error ? reason.message : "Unable to process the mask.",
            )
            setProcessedArtworkRevision((revision) => revision + 1)
          }
        }
      })
    return () => controller.abort()
  }, [
    activeArtworkConfig.maskChannel,
    activeArtworkMaskEffects,
    artworkMaskProcessingReady,
    artworkMaskEffectsActive,
    artworkEffectsKey,
    card.artwork,
    selectedArtworkMask,
    requestedArtworkMaskFrame,
    artworkEffectsRetry,
  ])
  useEffect(
    () => () => {
      processedArtworkPixelsRef.current = undefined
      disposeArtworkMaskWorker()
    },
    [],
  )
  // Defer the complete image/mask projection together, never a new mask with an older artwork.
  const projectedRenderCard = useMemo(
    () =>
      projectCardForRender(
        card,
        mode,
        artworkMask,
        activeEditorTemplate,
        processedArtworkMask ?? selectedArtworkMask,
      ),
    [activeEditorTemplate, artworkMask, card, mode, processedArtworkMask, selectedArtworkMask],
  )
  const renderCardData = useDeferredValue(projectedRenderCard)
  const plainCardName = useMemo(
    () => plainTextFromRichText(parseRichText(deferredCard.name).document),
    [deferredCard.name],
  )
  const cardFields = useMemo(
    () => editorCardFieldsForMode(deferredCard, mode, activeEditorTemplate),
    [activeEditorTemplate, deferredCard, mode],
  )
  const automaticCardFields = useMemo(
    () => editorCardFieldsForMode(deferredCard, "automatic", activeEditorTemplate),
    [activeEditorTemplate, deferredCard],
  )
  const currentDocument = useMemo<EditorDocumentState>(
    () => ({
      artworkMask,
      artworkMaskEffects,
      card,
      layers,
      mode,
      presetOverrides,
      presentationOverrides,
      templateId: storedTemplateId,
      templateVersion: storedTemplateVersion,
    }),
    [
      card,
      artworkMask,
      artworkMaskEffects,
      layers,
      mode,
      presentationOverrides,
      presetOverrides,
      storedTemplateId,
      storedTemplateVersion,
    ],
  )
  const hasUnsavedChanges = savedDocument
    ? !editorDocumentsEqual(currentDocument, savedDocument)
    : false

  useEffect(() => {
    let cancelled = false
    inventoryCard.current = undefined
    const timeout = window.setTimeout(() => {
      setInventoryBusy(true)
      setInventoryError(undefined)
      setInventorySaveError(undefined)
      setNewCardError(undefined)
      setTemplateBundle(undefined)
      setSavedDocument(undefined)
      setPendingSnapshotCardId(undefined)
      startedSnapshotCardId.current = undefined
      // A commit invalidated by this navigation never reaches its own cleanup, so the flag it
      // raised is cleared here with the rest of the previous card's transient state.
      setSavingCard(false)

      void readInventoryCard(cardId)
        .then(async (saved) => {
          if (cancelled) return
          if (!saved) throw new Error("This inventory card does not exist.")

          const loaded = await migrateInventoryCardToCurrentTemplate(saved)
          const document = loaded.document
          const storedPreview = await readInventoryPreview(saved.id)
          if (cancelled) return
          inventoryCard.current = loaded
          writeActiveInventoryCardId(loaded.id)
          replaceDocument(document)
          // The saved baseline is what storage actually holds. A migrated document differs from it
          // until the commit below lands, which is honest: the editor shows unsaved work, and a
          // failed commit leaves Save available to finish the job.
          const owesCommit =
            loaded !== saved ||
            !storedPreview ||
            !inventoryPreviewMatchesCard(storedPreview, loaded)
          setPendingSnapshotCardId(owesCommit ? loaded.id : undefined)
          setSavedDocument(owesCommit ? saved.document : document)
          setSelectedTemplateId(document.templateId)
          setInventoryBusy(false)
          setNewCardBusy(false)
        })
        .catch((error: unknown) => {
          if (cancelled) return
          setInventoryError(error instanceof Error ? error.message : String(error))
          setInventoryBusy(false)
          setNewCardBusy(false)
        })
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [cardId, replaceDocument])

  useEffect(() => {
    if (!hasUnsavedChanges) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warnBeforeUnload)
    return () => window.removeEventListener("beforeunload", warnBeforeUnload)
  }, [hasUnsavedChanges])

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
          typography.fitProfiles &&
          typography.fitProfiles.length > 0,
      ),
    [activeEditorTemplate, presentation.text],
  )
  const paintableText = useMemo(
    () => paintableTextStyles(layers, presentation, activeEditorTemplate),
    [activeEditorTemplate, layers, presentation],
  )
  const compressibleText = useMemo(
    () =>
      Object.values(presentation.text).filter(({ typography }) =>
        Boolean(
          typography.maxAutoCompressionX !== undefined ||
          typography.fitProfiles?.some(
            ({ maxAutoCompressionX }) => maxAutoCompressionX !== undefined,
          ),
        ),
      ),
    [presentation.text],
  )

  const selectedOfficialTemplate = editorTemplateCatalog.find(({ id }) => id === selectedTemplateId)
  const storedTemplate = storedTemplates.find(({ id }) => id === selectedTemplateId)
  const selectedTemplateVersion = selectedOfficialTemplate?.version ?? storedTemplate?.version
  const selectedTemplateName =
    selectedOfficialTemplate?.name ?? storedTemplate?.bundle.manifest.name
  const selectedTemplateIsUser = storedTemplate?.source === "user"
  const templateBundleMatchesSelection = templateBundleMatchesVersion(
    templateBundle,
    selectedTemplateId,
    selectedTemplateVersion,
  )
  const templateCacheBytes =
    storedTemplates.reduce((total, template) => total + template.sizeBytes, 0) +
    preparedTextureBytes

  const refreshTemplateStorage = useCallback(async () => {
    try {
      const snapshot = await readTemplateStorageSnapshot()
      setStoredTemplates(snapshot.templates)
      setOriginStorage(snapshot.originStorage)
      setPreparedTextureBytes(snapshot.preparedTextureBytes)
      setTemplateStorageMode(snapshot.storageMode)
      setTemplateStorageReady(true)
      setTemplateStorageError(undefined)
      if (
        storedTemplateId.startsWith("user/") &&
        !snapshot.templates.some(({ id, source }) => id === storedTemplateId && source === "user")
      ) {
        setTemplateIdentity(DEFAULT_TEMPLATE_ID, editorTemplateVersion)
      }
    } catch (error: unknown) {
      setTemplateStorageReady(true)
      setTemplateStorageError(error instanceof Error ? error.message : String(error))
    }
  }, [setTemplateIdentity, storedTemplateId])

  useEffect(() => {
    let cancelled = false
    void readTemplateStorageSnapshot()
      .then((snapshot) => {
        if (cancelled) return
        setStoredTemplates(snapshot.templates)
        setOriginStorage(snapshot.originStorage)
        setPreparedTextureBytes(snapshot.preparedTextureBytes)
        setTemplateStorageMode(snapshot.storageMode)
        setTemplateStorageReady(true)
        setTemplateStorageError(undefined)
        if (
          storedTemplateId.startsWith("user/") &&
          !snapshot.templates.some(({ id, source }) => id === storedTemplateId && source === "user")
        ) {
          setTemplateIdentity(DEFAULT_TEMPLATE_ID, editorTemplateVersion)
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setTemplateStorageReady(true)
        setTemplateStorageError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      cancelled = true
    }
  }, [setTemplateIdentity, storedTemplateId])

  const loadSelectedTemplate = useCallback(
    async ({ cachedOnly = false }: { cachedOnly?: boolean } = {}) => {
      templateLoadController.current?.abort()
      const controller = new AbortController()
      templateLoadController.current = controller
      setTemplateBundle(undefined)
      setTemplateLoadError(undefined)
      setTemplateLoadPaused(false)
      setTemplateLoadProgress({ loaded: 0, phase: "downloading" })
      setTemplateLoading(true)

      try {
        let cachedTemplate: StoredTemplateRecord | undefined
        try {
          cachedTemplate = await readStoredTemplate(selectedTemplateId)
          setTemplateStorageMode(getTemplateStorageMode())
        } catch (error: unknown) {
          if (!controller.signal.aborted) {
            setTemplateStorageMode(getTemplateStorageMode())
            setTemplateStorageError(error instanceof Error ? error.message : String(error))
          }
        }

        let cachedBundle: CardTemplateBundle | undefined
        if (cachedTemplate) {
          try {
            cachedBundle = validateTemplateBundle(cachedTemplate.bundle, {
              requireUserId: cachedTemplate.source === "user",
            })
          } catch (error) {
            if (cachedTemplate.source === "user") throw error
            cachedTemplate = undefined
          }
        }

        if (cachedOnly && !cachedTemplate) {
          setTemplateLoadProgress(undefined)
          return
        }

        if (cachedTemplate?.source === "user") {
          if (!cachedBundle) throw new Error("The stored user template has no bundle.")
          const compatibility = templateEditorCompatibility(
            cachedBundle.template,
            cachedBundle.colorPresets,
          )
          if (!compatibility.compatible) {
            throw new Error(
              `This template is stored safely but cannot drive the current card editor because ${compatibility.reason}.`,
            )
          }
          if (controller.signal.aborted) return
          setTemplateLoadProgress({
            loaded: cachedTemplate.sizeBytes,
            phase: "ready",
            total: cachedTemplate.sizeBytes,
          })
          setTemplateBundle(cachedBundle)
          setTemplateIdentity(cachedBundle.manifest.id, cachedBundle.manifest.version)
          return
        }

        const officialTemplate = getOfficialTemplate(selectedTemplateId)
        if (cachedOnly && cachedTemplate?.version !== officialTemplate.version) {
          setTemplateLoadProgress(undefined)
          return
        }
        if (
          !controller.signal.aborted &&
          cachedTemplate?.version === officialTemplate.version &&
          cachedBundle
        ) {
          const compatibility = templateEditorCompatibility(
            cachedBundle.template,
            cachedBundle.colorPresets,
          )
          if (!compatibility.compatible) {
            throw new Error(
              `This official template cannot drive the current card editor because ${compatibility.reason}.`,
            )
          }
          setTemplateLoadProgress({
            loaded: cachedTemplate.sizeBytes,
            phase: "ready",
            total: cachedTemplate.sizeBytes,
          })
          setTemplateBundle(cachedBundle)
          setTemplateIdentity(cachedBundle.manifest.id, cachedBundle.manifest.version)
          return
        }

        const bundle = await officialTemplate.load({
          signal: controller.signal,
          onProgress: (progress) => {
            if (!controller.signal.aborted) setTemplateLoadProgress(progress)
          },
        })
        if (controller.signal.aborted) return
        const validatedBundle = validateTemplateBundle(bundle)
        const compatibility = templateEditorCompatibility(
          validatedBundle.template,
          validatedBundle.colorPresets,
        )
        if (!compatibility.compatible) {
          throw new Error(
            `This official template cannot drive the current card editor because ${compatibility.reason}.`,
          )
        }
        try {
          await storeTemplate(validatedBundle)
          await refreshTemplateStorage()
        } catch (error: unknown) {
          setTemplateStorageError(error instanceof Error ? error.message : String(error))
        }
        if (!controller.signal.aborted) {
          setTemplateBundle(validatedBundle)
          setTemplateIdentity(validatedBundle.manifest.id, validatedBundle.manifest.version)
        }
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          setTemplateLoadProgress(undefined)
          setTemplateLoadError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (templateLoadController.current === controller) {
          templateLoadController.current = undefined
          setTemplateLoading(false)
        }
      }
    },
    [refreshTemplateStorage, selectedTemplateId, setTemplateIdentity],
  )

  useEffect(() => {
    if (inventoryBusy || !templateStorageReady || templateLoading || !selectedTemplateVersion) {
      return
    }

    const activeBundleMatchesSelection = templateBundleMatchesVersion(
      templateBundle,
      selectedTemplateId,
      selectedTemplateVersion,
    )
    if (activeBundleMatchesSelection) return

    const restoreKey = `${selectedTemplateId}@${selectedTemplateVersion}`
    if (automaticTemplateRestore.current === restoreKey) return
    automaticTemplateRestore.current = restoreKey
    void loadSelectedTemplate({
      cachedOnly: selectedTemplateIsUser,
    })
  }, [
    loadSelectedTemplate,
    inventoryBusy,
    selectedTemplateId,
    selectedTemplateVersion,
    selectedTemplateIsUser,
    storedTemplate,
    templateBundle,
    templateLoading,
    templateStorageReady,
  ])

  /**
   * Grades this bundle's textures once it is active, and keeps the result beside it.
   *
   * Activation is the right moment: the bundle is complete and validated, the card it is about to
   * draw has not been rendered yet, and every later render — preview, export, saved thumbnail —
   * reads the same textures. Failure is silent by design; `acquirePreparedTextures` returns nothing
   * and the renderer grades live, so preparation can never keep a card off the screen.
   */
  useEffect(() => {
    // Textures outlive a cleared bundle until the next one has prepared its own. Nothing draws them
    // in between: `preparedTexturesForBundle` hands the renderer only the textures that belong to
    // the bundle it is rendering.
    if (!templateBundle) return
    const controller = new AbortController()
    void acquirePreparedTextures(templateBundle, {
      onProgress: (completed, total) => {
        if (!controller.signal.aborted)
          setTemplateLoadProgress({ completed, phase: "preparing", total })
      },
      signal: controller.signal,
    }).then((prepared) => {
      if (controller.signal.aborted) return
      activeTexturesRef.current = prepared
      setActiveTextures(prepared)
    })
    return () => controller.abort()
  }, [templateBundle])

  const preparedTextures = useMemo(
    () => preparedTexturesForBundle(activeTextures, templateBundle),
    [activeTextures, templateBundle],
  )
  /** The card waits for this, so it is drawn once rather than redrawn when textures arrive. */
  const templateReady = preparedTexturesSettled(activeTextures, templateBundle)

  function selectTemplate(templateId: string) {
    templateLoadController.current?.abort()
    setTemplateLoading(false)
    setTemplateBundle(undefined)
    setTemplateLoadError(undefined)
    setTemplateLoadPaused(false)
    setTemplateLoadProgress(undefined)
    setTemplateDocumentError(undefined)
    setTemplateEditorOpen(false)
    automaticTemplateRestore.current = undefined
    setTemplateIdentity(DEFAULT_TEMPLATE_ID, editorTemplateVersion)
    setSelectedTemplateId(templateId)
  }

  async function removeSelectedTemplate() {
    templateLoadController.current?.abort()
    setTemplateLoading(false)
    try {
      if (selectedTemplateIsUser) {
        const dependentCards = (await listInventoryCards()).filter(
          ({ templateId }) => templateId === selectedTemplateId,
        )
        if (dependentCards.length > 0) {
          throw new Error(
            `This template is used by ${dependentCards.length} inventory card${dependentCards.length === 1 ? "" : "s"}. Delete or migrate those cards first.`,
          )
        }
      } else if (selectedTemplateVersion) {
        // Clearing persistent assets is intentional. Keep the already validated bundle alive for
        // this editor session and prevent the automatic restore effect from undoing the clear.
        automaticTemplateRestore.current = `${selectedTemplateId}@${selectedTemplateVersion}`
        setTemplateLoadPaused(true)
      }
      await deleteStoredTemplate(selectedTemplateId)
      await refreshTemplateStorage()
      setTemplateLoadError(undefined)
      setTemplateLoadProgress(undefined)
      setTemplateEditorOpen(false)
      if (selectedTemplateIsUser) {
        setTemplateLoadPaused(false)
        setTemplateBundle(undefined)
        setSelectedTemplateId(DEFAULT_TEMPLATE_ID)
        setTemplateIdentity(DEFAULT_TEMPLATE_ID, editorTemplateVersion)
      }
    } catch (error: unknown) {
      setTemplateStorageMode(getTemplateStorageMode())
      setTemplateStorageError(error instanceof Error ? error.message : String(error))
    }
  }

  useEffect(
    () => () => {
      templateLoadController.current?.abort()
      downloadUrls.current.forEach((url) => URL.revokeObjectURL(url))
    },
    [],
  )

  function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob)
    downloadUrls.current.push(url)
    const link = document.createElement("a")
    link.download = fileName
    link.href = url
    document.body.append(link)
    link.click()
    link.remove()
  }

  async function processedMaskForDocument(
    document: EditorDocumentState,
    template = activeEditorTemplate,
  ) {
    const config = artworkEditorConfig(template)
    requireCompletedArtworkMask(document, config.field)
    const source = selectArtworkMask(document.artworkMask)
    if (!source) return undefined
    const effects = config.maskField ? document.artworkMaskEffects[config.maskField] : undefined
    // Reuse only an exact completed frame. The visible fallback may have older effects while
    // controls are changing, so source identity alone is insufficient for save/export correctness.
    if (
      processedArtwork?.blob &&
      processedArtwork.source === source &&
      processedArtwork.channel === config.maskChannel &&
      processedArtwork.effectsKey === artworkMaskEffectsKey(effects)
    )
      return processedArtwork.blob
    // An export owns its document snapshot. It must not publish into a preview that may have
    // advanced to different settings while this asynchronous work was running.
    return processArtworkMaskBlob(source, effects, config.maskChannel)
  }

  async function downloadExport() {
    if (!templateBundle) return
    setExporting(true)
    setExportError(undefined)
    try {
      const processedMask = await processedMaskForDocument(currentDocument)
      const exportCard = projectCardForRender(
        currentDocument.card,
        currentDocument.mode,
        currentDocument.artworkMask,
        activeEditorTemplate,
        processedMask,
      )
      if (exportFormat === "svg") {
        const svg = await exportCardToSvg(exportCard, {
          layers,
          preparedTextures,
          presetOverrides,
          presentationOverrides,
          templateBundle,
          title: plainCardName,
        })
        downloadBlob(
          new Blob([svg], { type: "image/svg+xml" }),
          `${safeFileName(plainCardName)}.svg`,
        )
        return
      }
      const size = rasterSizeForChoice(rasterSizeChoice, rasterCustomDimension)
      if ((rasterSizeChoice === "width" || rasterSizeChoice === "height") && !size) {
        throw new Error("Custom image size must be a positive whole number of pixels.")
      }
      const image = await exportCardToImage(exportCard, {
        ...(exportFormat === "jpeg" ? { backgroundColor: rasterBackground } : {}),
        format: exportFormat,
        layers,
        preparedTextures,
        presetOverrides,
        presentationOverrides,
        ...(exportFormat === "png" ? {} : { quality: rasterQuality / 100 }),
        size,
        templateBundle,
      })
      const extension = exportFormat === "jpeg" ? "jpg" : exportFormat
      downloadBlob(image, `${safeFileName(plainCardName)}.${extension}`)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error))
    } finally {
      setExporting(false)
    }
  }

  async function downloadJson() {
    setDocumentTransferBusy(true)
    setDocumentTransferError(undefined)
    try {
      const json = await serializeEditorDocument({
        artworkMask,
        artworkMaskEffects,
        card,
        layers,
        mode,
        presetOverrides,
        presentationOverrides,
        templateId: storedTemplateId,
        templateVersion: storedTemplateVersion,
      })
      downloadBlob(
        new Blob([json], { type: "application/json" }),
        `${safeFileName(plainCardName)}.json`,
      )
    } catch (error) {
      setDocumentTransferError(error instanceof Error ? error.message : String(error))
    } finally {
      setDocumentTransferBusy(false)
    }
  }

  async function importJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    setDocumentTransferBusy(true)
    setDocumentTransferError(undefined)
    try {
      if (file.size > maximumEditorDocumentBytes) {
        throw new Error(
          `Editor documents must be smaller than ${maximumEditorDocumentBytes / 1024 / 1024} MiB.`,
        )
      }
      let document = parseEditorDocument(await file.text())
      if (document.templateId.startsWith("user/")) {
        const stored = await readStoredTemplate(document.templateId)
        setTemplateStorageMode(getTemplateStorageMode())
        if (!stored || stored.source !== "user") {
          throw new Error(
            `The editor document requires user template "${document.templateId}", which is not stored in this browser. Import the template first.`,
          )
        }
        document = migrateInventoryCardDocument(
          document,
          {
            ...createInitialEditorDocument(),
            templateId: stored.id,
            templateVersion: stored.version,
          },
          stored.bundle.template,
          stored.bundle.colorPresets,
        )
      }
      replaceDocument(document)
      setSelectedTemplateId(document.templateId)
      setTemplateBundle(undefined)
      setTemplateLoadError(undefined)
      setTemplateLoadProgress(undefined)
    } catch (error) {
      setDocumentTransferError(error instanceof Error ? error.message : String(error))
    } finally {
      setDocumentTransferBusy(false)
    }
  }

  function transferTemplateBundle() {
    return templateBundle ?? storedTemplate?.bundle
  }

  async function exportTemplate() {
    const bundle = transferTemplateBundle()
    if (!bundle) {
      setTemplateDocumentError("Load or cache a template before exporting it.")
      return
    }
    setTemplateDocumentBusy(true)
    setTemplateDocumentError(undefined)
    try {
      const json = await serializeTemplateBundleDocument(bundle)
      downloadBlob(
        new Blob([json], { type: "application/json" }),
        `${safeFileName(bundle.manifest.name)}.yugilife-template.json`,
      )
    } catch (error: unknown) {
      setTemplateDocumentError(error instanceof Error ? error.message : String(error))
    } finally {
      setTemplateDocumentBusy(false)
    }
  }

  async function importTemplate(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    setTemplateDocumentBusy(true)
    setTemplateDocumentError(undefined)
    try {
      if (file.size > maximumTemplateDocumentBytes) {
        throw new Error(
          `Template files must be smaller than ${maximumTemplateDocumentBytes / 1024 / 1024} MiB.`,
        )
      }
      const imported = parseTemplateBundleDocument(await file.text())
      const userBundle = makeUserTemplateCopy(imported)
      await storeTemplate(userBundle, "user")
      await refreshTemplateStorage()
      setSelectedTemplateId(userBundle.manifest.id)
      setTemplateBundle(undefined)
      setTemplateLoadError(undefined)
      setTemplateLoadProgress(undefined)
      setTemplateIdentity(DEFAULT_TEMPLATE_ID, editorTemplateVersion)
      setTemplateDraft(serializeTemplateSourceDocument(userBundle))
      setTemplateEditorOpen(true)
    } catch (error: unknown) {
      setTemplateDocumentError(error instanceof Error ? error.message : String(error))
    } finally {
      setTemplateDocumentBusy(false)
    }
  }

  async function beginTemplateEditing() {
    const bundle = transferTemplateBundle()
    if (!bundle) {
      setTemplateDocumentError("Load or cache a template before editing it.")
      return
    }
    setTemplateDocumentBusy(true)
    setTemplateDocumentError(undefined)
    try {
      let editable = bundle
      if (!selectedTemplateIsUser) {
        editable = makeUserTemplateCopy(bundle)
        await storeTemplate(editable, "user")
        await refreshTemplateStorage()
        setSelectedTemplateId(editable.manifest.id)
        setTemplateBundle(undefined)
        setTemplateIdentity(DEFAULT_TEMPLATE_ID, editorTemplateVersion)
      }
      setTemplateDraft(serializeTemplateSourceDocument(editable))
      setTemplateEditorOpen(true)
    } catch (error: unknown) {
      setTemplateDocumentError(error instanceof Error ? error.message : String(error))
    } finally {
      setTemplateDocumentBusy(false)
    }
  }

  async function applyTemplateEdit() {
    if (!storedTemplate || storedTemplate.source !== "user") {
      setTemplateDocumentError("Only a stored user template can be edited.")
      return
    }
    setTemplateDocumentBusy(true)
    setTemplateDocumentError(undefined)
    try {
      const source = parseTemplateSourceDocument(templateDraft)
      const next = applyTemplateSourceDocument(source, storedTemplate.bundle.assets)
      if (next.manifest.id !== storedTemplate.id) {
        throw new Error(
          "A stored template's identity cannot be changed while editing it. Create a new editable copy instead.",
        )
      }
      await storeTemplate(next, "user")
      await refreshTemplateStorage()
      const wasActive = templateBundle?.manifest.id === storedTemplate.id
      setSelectedTemplateId(next.manifest.id)
      setTemplateEditorOpen(false)
      setTemplateDraft("")
      if (wasActive) {
        const compatibility = templateEditorCompatibility(next.template, next.colorPresets)
        if (compatibility.compatible) {
          setTemplateBundle(next)
          setTemplateIdentity(next.manifest.id, next.manifest.version)
        } else {
          setTemplateBundle(undefined)
          setTemplateIdentity(DEFAULT_TEMPLATE_ID, editorTemplateVersion)
          setTemplateLoadError(
            `Saved, but the edited template cannot drive the current card editor because ${compatibility.reason}.`,
          )
        }
      }
    } catch (error: unknown) {
      setTemplateDocumentError(error instanceof Error ? error.message : String(error))
    } finally {
      setTemplateDocumentBusy(false)
    }
  }

  function resetEditor() {
    reset()
    if (templateBundle) {
      setTemplateIdentity(templateBundle.manifest.id, templateBundle.manifest.version)
    }
  }

  function applyCatalogCardPatch(
    patch: Readonly<Record<string, CardFieldValue>>,
    nextArtworkMask: EditorDocumentState["artworkMask"],
  ) {
    const nextCard = { ...card, ...patch }
    validateCardData(nextCard, activeEditorTemplate)
    applyCardPatchWithArtworkMask(patch, nextArtworkMask)
  }

  const reference = referenceLibrary.selectedReference

  function changeComparisonMode(mode: string) {
    if (mode !== "off" && mode !== "overlay" && mode !== "side-by-side") {
      setSettingsStorageError("Comparison settings contain an invalid mode.")
      return
    }
    setComparisonMode(mode)
    const error = writeComparisonMode(mode)
    if (error) setSettingsStorageError(error)
    else setSettingsStorageError(undefined)
  }

  function changeReferenceOpacity(opacity: number) {
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 100) {
      setSettingsStorageError("Reference settings contain an invalid opacity.")
      return
    }
    setReferenceOpacity(opacity)
    const error = writeReferenceOpacity(opacity)
    if (error) setSettingsStorageError(error)
    else setSettingsStorageError(undefined)
  }

  function clearActiveOverride(override: ActivePresentationOverride) {
    switch (override.kind) {
      case "artwork-transform":
        clearArtworkTransform(override.transformId)
        break
      case "artwork-mask-effects":
        clearArtworkMaskEffects(override.maskField)
        break
      case "layer":
        clearLayerOverride(override.layerId)
        break
      case "layer-mask":
        clearLayerMaskOverride(override.layerId)
        break
      case "preset":
        clearPresetOverride(override.target)
        break
      case "text-fit":
        clearTextFitProfile(override.layerId, override.styleId)
        break
      case "text-typography":
        clearTextTypography(override.layerId, override.styleId)
        break
    }
  }

  async function returnToInventory() {
    await navigate("/inventory")
  }

  async function saveCard() {
    const current = inventoryCard.current
    if (!current || savingCard || !hasUnsavedChanges) return
    if (
      !templateBundle ||
      templateBundle.manifest.id !== currentDocument.templateId ||
      templateBundle.manifest.version !== currentDocument.templateVersion
    ) {
      setInventorySaveError(
        "The active template must finish loading before this card can be saved.",
      )
      return
    }

    const document = currentDocument
    const next = {
      ...current,
      document,
      revision: current.revision + 1,
      title:
        plainTextFromRichText(parseRichText(document.card.name).document).trim() || "Untitled card",
      updatedAt: Date.now(),
    }
    setSavingCard(true)
    setInventorySaveError(undefined)
    try {
      const image = await renderInventoryPreview(
        document,
        templateBundle,
        await processedMaskForDocument(document),
        preparedTextures,
      )
      await saveInventoryCardSnapshot(next, {
        cardId: next.id,
        cardRevision: next.revision,
        image,
      })
      inventoryCard.current = next
      setSavedDocument(document)
    } catch (error: unknown) {
      setInventorySaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSavingCard(false)
    }
  }

  /**
   * Commits an opened card that storage still owes a snapshot for. Opening a card is the only
   * moment a stored document is migrated, and the migration is not persisted until its thumbnail
   * has been rendered — so inventory never holds a document whose preview depicts a different one.
   */
  useEffect(() => {
    const card = inventoryCard.current
    if (!pendingSnapshotCardId || !card || card.id !== pendingSnapshotCardId) return
    if (startedSnapshotCardId.current === pendingSnapshotCardId) return
    if (
      !templateBundle ||
      templateBundle.manifest.id !== card.document.templateId ||
      templateBundle.manifest.version !== card.document.templateVersion
    ) {
      return
    }
    startedSnapshotCardId.current = pendingSnapshotCardId
    const token = (snapshotCommitToken.current += 1)
    const active = () => snapshotCommitToken.current === token
    const document = card.document
    setSavingCard(true)
    void (async () => {
      try {
        const image = await renderInventoryPreview(
          document,
          templateBundle,
          await processedInventoryMask(document, templateBundle),
          // Read rather than depended on: textures arriving mid-commit must not restart a write
          // this effect has already begun, and a commit that finishes first is correct without them.
          preparedTexturesForBundle(activeTexturesRef.current, templateBundle),
        )
        if (!active()) return
        await saveInventoryCardSnapshot(card, {
          cardId: card.id,
          cardRevision: card.revision,
          image,
        })
        if (active()) setSavedDocument(document)
      } catch (error: unknown) {
        // The document stays unpersisted, so the editor keeps showing unsaved changes and Save can
        // finish what this could not.
        if (active()) {
          setInventorySaveError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (active()) setSavingCard(false)
      }
    })()
    return () => {
      snapshotCommitToken.current += 1
    }
    // The two signals that can unblock a commit: the card that owes one, and the bundle it must be
    // rendered with. Whichever arrives last starts the write.
  }, [pendingSnapshotCardId, templateBundle])

  async function createNewCard() {
    setNewCardBusy(true)
    setNewCardError(undefined)
    try {
      const next = await createInventoryCard(createInitialEditorDocument())
      writeActiveInventoryCardId(next.id)
      await navigate(`/build/${encodeURIComponent(next.id)}`)
    } catch (error: unknown) {
      setNewCardError(error instanceof Error ? error.message : String(error))
      setNewCardBusy(false)
    }
  }

  return {
    activeDefaultLayerVisibility,
    activeEditorTemplate,
    activeLayerGroups,
    activeOverrides,
    activePresetTargets,
    applyCatalogCardPatch,
    applyTemplateEdit,
    completeArtworkMask,
    artworkMaskPending: artworkMaskPending(currentDocument, activeArtworkConfig.field),
    artworkEffectsError: requestedArtworkMaskFrame ? artworkEffectsError : undefined,
    retryArtworkEffects: () => {
      disposeArtworkMaskWorker()
      setFailedArtworkMaskFrame(undefined)
      setArtworkEffectsError(undefined)
      setArtworkEffectsRetry((value) => value + 1)
    },
    artworkMask,
    artworkMaskEffects,
    automaticCardFields,
    beginTemplateEditing,
    cancelTemplateEdit: () => {
      setTemplateEditorOpen(false)
      setTemplateDocumentError(undefined)
    },
    card,
    cardCatalog,
    cardFields,
    changeComparisonMode,
    changeReferenceOpacity,
    clearActiveOverride,
    clearAllPresentationOverrides,
    comparisonMode,
    compressibleText,
    createNewCard,
    debugLoggingEnabled,
    defaultPresentation,
    documentTransferBusy,
    documentTransferError,
    downloadExport,
    downloadJson,
    exportError,
    exportFormat,
    exporting,
    exportTemplate,
    fittedText,
    hasUnsavedChanges,
    paintableText,
    importJson,
    importTemplate,
    inventoryBusy,
    inventoryError,
    inventorySaveError,
    inventoryStorageMode: getInventoryStorageMode(),
    layers,
    loadSelectedTemplate,
    mode,
    newCardBusy,
    newCardError,
    originStorage,
    plainCardName,
    presentation,
    presentationOverrides,
    processedArtworkMask,
    getProcessedArtworkMaskPixels,
    preparedTextures,
    processedArtworkRevision,
    presetOverrides,
    processedArtworkBusy,
    rasterBackground,
    rasterCustomDimension,
    rasterOutputDimensions,
    rasterQuality,
    rasterSizeChoice,
    reference,
    referenceLibrary,
    referenceOpacity,
    removeSelectedTemplate,
    renderCardData,
    resetEditor,
    returnToInventory,
    saveCard,
    savingCard,
    selectTemplate,
    selectedTemplateId,
    selectedTemplateIsUser,
    selectedTemplateName,
    selectedTemplateVersion,
    setAllLayers,
    setArtworkMaskEffects,
    setArtworkTransform,
    setArtworkMask,
    setDebugLoggingEnabled,
    setExportFormat,
    setField,
    setLayer,
    setMode,
    setPresetOverride,
    setRasterBackground,
    setRasterCustomDimension,
    setRasterQuality,
    setRasterSizeChoice,
    setShowActiveOverrides,
    setTemplateDraft,
    setTextFitProfile,
    setTextTypography,
    settingsStorageError,
    showActiveOverrides,
    storedTemplate,
    storedTemplates,
    templateBundle,
    templateBundleMatchesSelection,
    templateCacheBytes,
    templateDocumentBusy,
    templateDocumentError,
    templateDraft,
    templateEditorOpen,
    templateLoadError,
    templateLoadPaused,
    templateLoadProgress,
    templateLoading,
    templateReady,
    templateStorageError,
    templateStorageMode,
    templateTransferAvailable: transferTemplateBundle() !== undefined,
  }
}
