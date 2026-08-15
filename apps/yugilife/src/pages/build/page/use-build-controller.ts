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
} from "yugilife-core"
import { DEFAULT_TEMPLATE_ID, getOfficialTemplate, TEMPLATE_CATALOG } from "yugilife-templates"

import {
  migrateInventoryCardDocument,
  migrateInventoryCardToCurrentTemplate,
} from "../../inventory/model/inventory-card-migration"
import { writeActiveInventoryCardId } from "../../inventory/persistence/inventory-settings"
import {
  createInventoryCard,
  getInventoryStorageMode,
  listInventoryCards,
  readInventoryCard,
  saveInventoryCard,
  saveInventoryCardSnapshot,
} from "../../inventory/persistence/inventory-storage"
import {
  editorCardFieldsForMode,
  editorColorPresets,
  editorTemplate,
  editorTemplateVersion,
  getActivePresentationOverrides,
  isAutomaticTextFitLayer,
  presetTargetsForTemplate,
  projectCardForEditorMode,
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

import type { ActivePresentationOverride } from "../editor/model/editor-config"
import type { EditorDocumentState } from "../editor/model/editor-document"
import type {
  OriginStorageEstimate,
  StoredTemplateRecord,
  TemplateStorageMode,
} from "../templates/template-storage"
import type { ChangeEvent } from "react"
import type { CardTemplateBundle, RasterImageFormat, RasterOutputSize } from "yugilife-core"
import type { TemplateLoadProgress } from "yugilife-templates"

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

export function editorDocumentsEqual(left: EditorDocumentState, right: EditorDocumentState) {
  return editorValuesEqual(left, right)
}

export function useBuildController(cardId: string) {
  const navigate = useNavigate()
  const card = useEditorStore(editorSelectors.card)
  const layers = useEditorStore(editorSelectors.layers)
  const mode = useEditorStore(editorSelectors.mode)
  const presetOverrides = useEditorStore(editorSelectors.presetOverrides)
  const presentationOverrides = useEditorStore(editorSelectors.presentationOverrides)
  const storedTemplateId = useEditorStore(editorSelectors.templateId)
  const storedTemplateVersion = useEditorStore(editorSelectors.templateVersion)
  const clearAllPresentationOverrides = useEditorStore(
    editorSelectors.clearAllPresentationOverrides,
  )
  const clearLayerMaskOverride = useEditorStore(editorSelectors.clearLayerMaskOverride)
  const clearLayerOverride = useEditorStore(editorSelectors.clearLayerOverride)
  const clearPresetOverride = useEditorStore(editorSelectors.clearPresetOverride)
  const clearTextFitProfile = useEditorStore(editorSelectors.clearTextFitProfile)
  const clearTextTypography = useEditorStore(editorSelectors.clearTextTypography)
  const reset = useEditorStore(editorSelectors.reset)
  const replaceDocument = useEditorStore(editorSelectors.replaceDocument)
  const setAllLayers = useEditorStore(editorSelectors.setAllLayers)
  const setField = useEditorStore(editorSelectors.setField)
  const setLayer = useEditorStore(editorSelectors.setLayer)
  const setMode = useEditorStore(editorSelectors.setMode)
  const setPresetOverride = useEditorStore(editorSelectors.setPresetOverride)
  const setTextFitProfile = useEditorStore(editorSelectors.setTextFitProfile)
  const setTextTypography = useEditorStore(editorSelectors.setTextTypography)
  const setTemplateIdentity = useEditorStore(editorSelectors.setTemplateIdentity)
  const [selectedTemplateIdOverride, setSelectedTemplateId] = useState<string>()
  const [templateBundle, setTemplateBundle] = useState<CardTemplateBundle>()
  const [templateLoadError, setTemplateLoadError] = useState<string>()
  const [templateLoadPaused, setTemplateLoadPaused] = useState(false)
  const [templateLoadProgress, setTemplateLoadProgress] = useState<TemplateLoadProgress>()
  const [templateLoading, setTemplateLoading] = useState(false)
  const templateLoadController = useRef<AbortController | undefined>(undefined)
  const automaticTemplateRestore = useRef<string | undefined>(undefined)
  const [storedTemplates, setStoredTemplates] = useState<readonly StoredTemplateRecord[]>([])
  const [templateStorageReady, setTemplateStorageReady] = useState(false)
  const [originStorage, setOriginStorage] = useState<OriginStorageEstimate>({})
  const [templateStorageMode, setTemplateStorageMode] =
    useState<TemplateStorageMode>(getTemplateStorageMode())
  const [templateStorageError, setTemplateStorageError] = useState<string>()
  const [templateDocumentBusy, setTemplateDocumentBusy] = useState(false)
  const [templateDocumentError, setTemplateDocumentError] = useState<string>()
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false)
  const [templateDraft, setTemplateDraft] = useState("")
  const [comparisonMode, setComparisonMode] = useState<"overlay" | "side-by-side">(
    readComparisonMode,
  )
  const [documentTransferError, setDocumentTransferError] = useState<string>()
  const [documentTransferBusy, setDocumentTransferBusy] = useState(false)
  const [exportError, setExportError] = useState<string>()
  const [exportFormat, setExportFormat] = useState<ExportFormat>("png")
  const [exporting, setExporting] = useState(false)
  const [rasterBackground, setRasterBackground] = useState("#ffffff")
  const [rasterCustomDimension, setRasterCustomDimension] = useState("813")
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
  const renderCardData = useMemo(
    () => projectCardForEditorMode(deferredCard, mode, activeEditorTemplate),
    [activeEditorTemplate, deferredCard, mode],
  )
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

      void readInventoryCard(cardId)
        .then(async (saved) => {
          if (cancelled) return
          if (!saved) throw new Error("This inventory card does not exist.")

          const loaded = await migrateInventoryCardToCurrentTemplate(saved)
          const document = loaded.document
          if (loaded !== saved) await saveInventoryCard(loaded)
          if (cancelled) return
          inventoryCard.current = loaded
          writeActiveInventoryCardId(loaded.id)
          replaceDocument(document)
          setSavedDocument(document)
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
      ),
    [
      activeEditorColorPresets,
      activeEditorTemplate,
      layers,
      presentation,
      presentationOverrides,
      presetOverrides,
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
  const templateCacheBytes = storedTemplates.reduce(
    (total, template) => total + template.sizeBytes,
    0,
  )

  const refreshTemplateStorage = useCallback(async () => {
    try {
      const snapshot = await readTemplateStorageSnapshot()
      setStoredTemplates(snapshot.templates)
      setOriginStorage(snapshot.originStorage)
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

  async function downloadExport() {
    if (!templateBundle) return
    setExporting(true)
    setExportError(undefined)
    try {
      if (exportFormat === "svg") {
        const svg = await exportCardToSvg(renderCardData, {
          layers,
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
      const image = await exportCardToImage(renderCardData, {
        ...(exportFormat === "jpeg" ? { backgroundColor: rasterBackground } : {}),
        format: exportFormat,
        layers,
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

  const reference = referenceLibrary.selectedReference

  function changeComparisonMode(mode: string) {
    if (mode !== "overlay" && mode !== "side-by-side") {
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
      const image = await exportCardToImage(
        projectCardForEditorMode(document.card, document.mode, activeEditorTemplate),
        {
          format: "png",
          layers: document.layers,
          presentationOverrides: document.presentationOverrides,
          presetOverrides: document.presetOverrides,
          size: { width: 240 },
          templateBundle,
        },
      )
      await saveInventoryCardSnapshot(next, {
        cardId: next.id,
        cardRevision: next.revision,
        image,
        renderFingerprint: `${document.templateId}@${document.templateVersion}:preview-v1`,
      })
      inventoryCard.current = next
      setSavedDocument(document)
    } catch (error: unknown) {
      setInventorySaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSavingCard(false)
    }
  }

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
    applyTemplateEdit,
    automaticCardFields,
    beginTemplateEditing,
    cancelTemplateEdit: () => {
      setTemplateEditorOpen(false)
      setTemplateDocumentError(undefined)
    },
    card,
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
    presetOverrides,
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
    templateStorageError,
    templateStorageMode,
    templateTransferAvailable: transferTemplateBundle() !== undefined,
  }
}
