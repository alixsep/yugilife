import { useCallback, useRef, useState } from "react"

import { ArrowLeft, CircleHelp, Download, Images, LayoutTemplate, Pencil } from "lucide-react"
import { Link } from "react-router"

import { AppNavigation } from "@/components/app-navigation"
import { Button } from "@/components/ui/button"
import { TabsSubtle, TabsSubtleItem, TabsSubtlePanel } from "@/components/ui/tabs-subtle"
import { useShape } from "@/lib/shape-context"
import { createZipBlob } from "@/lib/zip"

import { EditorSidebar } from "../editor/components/editor-sidebar"
import { artworkEditorConfig, shouldRenderArtworkWorkspace } from "../editor/model/editor-config"
import { ReferenceComparison } from "../references/reference-comparison"
import { TemplateManager } from "../templates/template-manager"

import { BuildGuide } from "./build-guide"
import { focusPrimaryCardFieldControl } from "./card-field-focus"
import { CardPreview } from "./card-preview"
import { ExportToolbar } from "./export-toolbar"
import { editorTemplateCatalog } from "./use-build-controller"

import type { ArtworkEditorTool } from "../editor/components/artwork-editor"
import type { useBuildController } from "./use-build-controller"
import type { CardRenderMetadata } from "@/components/card"
import type { RenderManifest } from "yugilife-core"

interface BuildViewProps {
  controller: ReturnType<typeof useBuildController>
}

export function BuildView({ controller }: BuildViewProps) {
  const shape = useShape()
  const artworkConfig = artworkEditorConfig(controller.activeEditorTemplate)
  const [workflow, setWorkflow] = useState(0)
  const renderMetadata = useRef<CardRenderMetadata | undefined>(undefined)
  const showExactBoundsRef = useRef(false)
  const [exactAnalysis, setExactAnalysis] = useState<{
    manifest: RenderManifest
    metadata: CardRenderMetadata
  }>()
  const [exactRequestMetadata, setExactRequestMetadata] = useState<CardRenderMetadata>()
  const [exactAnalysisFailure, setExactAnalysisFailure] = useState<CardRenderMetadata>()
  const [showExactBounds, setShowExactBounds] = useState(false)
  const [showTextInteractionBounds, setShowTextInteractionBounds] = useState(false)
  const [artworkPinSize, setArtworkPinSize] = useState(24)
  const [artworkSelectedPinId, setArtworkSelectedPinId] = useState<number | null>(null)
  const [artworkTool, setArtworkTool] = useState<ArtworkEditorTool>("select")
  const [alphaExportBusy, setAlphaExportBusy] = useState(false)
  const [alphaExportError, setAlphaExportError] = useState<string>()
  const {
    applyTemplateEdit,
    beginTemplateEditing,
    cancelTemplateEdit,
    documentTransferError,
    exportError,
    exportTemplate,
    importTemplate,
    hasUnsavedChanges,
    inventoryBusy,
    inventoryError,
    inventorySaveError,
    inventoryStorageMode,
    loadSelectedTemplate,
    newCardError,
    originStorage,
    referenceLibrary,
    removeSelectedTemplate,
    selectTemplate,
    selectedTemplateId,
    selectedTemplateIsUser,
    selectedTemplateName,
    selectedTemplateVersion,
    setTemplateDraft,
    storedTemplate,
    storedTemplates,
    templateBundleMatchesSelection,
    templateCacheBytes,
    templateDocumentBusy,
    templateDocumentError,
    templateDraft,
    templateEditorOpen,
    templateLoadError,
    templateLoadProgress,
    templateLoading,
    templateStorageError,
    templateStorageMode,
    templateTransferAvailable,
  } = controller

  const exactBoundsBusy = Boolean(
    showExactBounds &&
    exactRequestMetadata &&
    exactAnalysis?.metadata !== exactRequestMetadata &&
    exactAnalysisFailure !== exactRequestMetadata,
  )

  const changeArtworkTool = useCallback((tool: ArtworkEditorTool) => {
    setArtworkTool(tool)
    if (tool !== "select") setArtworkSelectedPinId(null)
  }, [])

  function changeExactBounds(visible: boolean) {
    showExactBoundsRef.current = visible
    setShowExactBounds(visible)
    if (!visible) return
    const metadata = renderMetadata.current
    if (!metadata) {
      showExactBoundsRef.current = false
      setShowExactBounds(false)
      return
    }
    setExactRequestMetadata(metadata)
    setExactAnalysis(undefined)
    setExactAnalysisFailure(undefined)
    setAlphaExportError(undefined)
    void metadata
      .createRenderManifest()
      .then((manifest) => {
        if (showExactBoundsRef.current && renderMetadata.current === metadata) {
          setExactAnalysis({ manifest, metadata })
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setExactAnalysisFailure(metadata)
          setAlphaExportError(error instanceof Error ? error.message : String(error))
        }
      })
  }

  const acceptRenderMetadata = useCallback((metadata: CardRenderMetadata | undefined) => {
    renderMetadata.current = metadata
    if (metadata || !showExactBoundsRef.current) return
    // Exact bounds describe one immutable rendered snapshot. Never carry them into an edit or
    // make normal rendering launch another alpha-analysis replay.
    showExactBoundsRef.current = false
    setShowExactBounds(false)
    setExactAnalysis(undefined)
    setExactAnalysisFailure(undefined)
    setExactRequestMetadata(undefined)
  }, [])

  const focusField = useCallback(
    (fieldName: string, controlIndex?: number) => {
      setWorkflow(0)
      const focus = () => {
        const container = document.querySelector<HTMLElement>(
          `[data-card-field="${CSS.escape(fieldName)}"]`,
        )
        if (!container) return false
        container.scrollIntoView({ behavior: "smooth", block: "center" })
        return focusPrimaryCardFieldControl(container, controlIndex)
      }
      requestAnimationFrame(() => {
        if (focus()) return
        controller.setMode("advanced")
        requestAnimationFrame(focus)
      })
    },
    [controller],
  )

  async function downloadAlphaChannels() {
    const currentMetadata = renderMetadata.current
    if (!currentMetadata) {
      setAlphaExportError("The current card has not finished preparing its alpha channels.")
      return
    }
    setAlphaExportBusy(true)
    setAlphaExportError(undefined)
    try {
      const renderManifest: RenderManifest =
        exactAnalysis?.metadata === currentMetadata
          ? exactAnalysis.manifest
          : await currentMetadata.createRenderManifest()
      const artifacts = (
        await Promise.all(
          renderManifest.elements.map(async (element, index) => {
            const extension = element.alpha.kind === "svg" ? "svg" : "png"
            const safeLayerId = element.layerId.replaceAll(/[^a-zA-Z0-9._-]+/g, "-")
            const filename = `${String(index + 1).padStart(3, "0")}-${safeLayerId}.${extension}`
            const [visible, absolute] = await Promise.all([
              element.alpha.toBlob(),
              element.absoluteAlpha.toBlob(),
            ])
            return [
              { data: visible, name: `visible/${filename}` },
              { data: absolute, name: `absolute/${filename}` },
            ]
          }),
        )
      ).flat()
      const manifestMetadata = renderManifest.elements.map(
        ({ absoluteAlpha, absoluteBounds, alpha, bounds, layerId, order, sourceFields }) => ({
          absoluteBounds,
          absoluteFileType: absoluteAlpha.mimeType,
          bounds,
          visibleFileType: alpha.mimeType,
          layerId,
          order,
          sourceFields,
        }),
      )
      const archive = await createZipBlob([
        { data: `${JSON.stringify(manifestMetadata, null, 2)}\n`, name: "manifest.json" },
        ...artifacts,
      ])
      const url = URL.createObjectURL(archive)
      const link = document.createElement("a")
      link.download = "yugilife-alpha-channels.zip"
      link.href = url
      document.body.append(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      setAlphaExportError(error instanceof Error ? error.message : String(error))
    } finally {
      setAlphaExportBusy(false)
    }
  }

  if (inventoryBusy) {
    return (
      <main className="grid min-h-dvh place-items-center">
        <p className="text-muted-foreground text-body">Opening your card…</p>
      </main>
    )
  }

  if (inventoryError) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div
          className={`${shape.container} border-border bg-card shadow-surface-2 grid max-w-md gap-3 border p-5`}
        >
          <h1 className="text-title font-medium">Could not open this card</h1>
          <p className="text-body text-destructive" role="alert">
            {inventoryError}
          </p>
          <Button asChild leadingIcon={ArrowLeft} variant="secondary">
            <Link to="/inventory">Return to inventory</Link>
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="bg-background text-foreground flex h-dvh flex-col overflow-hidden">
      <AppNavigation
        onBeforeNavigate={() =>
          !hasUnsavedChanges ||
          window.confirm("You have unsaved card edits. Leave without saving them?")
        }
      />

      <div className="mx-auto grid min-h-0 w-full max-w-[1920px] flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3 px-3 pt-0 pb-3 sm:px-4 sm:pb-4 lg:grid-cols-[minmax(25rem,30rem)_minmax(0,1fr)] lg:grid-rows-1">
        <div className="flex min-h-0 flex-col gap-2">
          {(newCardError ||
            exportError ||
            inventorySaveError ||
            documentTransferError ||
            alphaExportError) && (
            <div
              className={`${shape.bg} bg-destructive-light text-destructive text-body px-3 py-2`}
              role="alert"
            >
              {newCardError ??
                exportError ??
                inventorySaveError ??
                documentTransferError ??
                alphaExportError}
            </div>
          )}

          <div className="relative flex shrink-0 items-center justify-center">
            <TabsSubtle
              activeLabel
              idPrefix="build-workflow"
              selectedIndex={workflow}
              onSelect={setWorkflow}
            >
              <TabsSubtleItem icon={Pencil} index={0} label="Edit" />
              <TabsSubtleItem icon={LayoutTemplate} index={1} label="Template" />
              <TabsSubtleItem icon={Download} index={2} label="Export" />
              <TabsSubtleItem icon={Images} index={3} label="References" />
              <TabsSubtleItem icon={CircleHelp} index={4} label="Guide" />
            </TabsSubtle>
          </div>

          <div
            className={`${shape.container} border-border bg-card shadow-surface-1 min-h-0 flex-1 overflow-y-auto border`}
          >
            <TabsSubtlePanel idPrefix="build-workflow" index={0} selectedIndex={workflow}>
              <EditorSidebar
                alphaExportBusy={alphaExportBusy}
                alphaExportReady={templateBundleMatchesSelection}
                artworkPinSize={artworkPinSize}
                artworkSelectedPinId={artworkSelectedPinId}
                artworkTool={artworkTool}
                controller={controller}
                exactBoundsBusy={exactBoundsBusy}
                onArtworkPinSizeChange={setArtworkPinSize}
                onArtworkSelectedPinChange={setArtworkSelectedPinId}
                onArtworkToolChange={changeArtworkTool}
                showExactBounds={showExactBounds}
                showTextInteractionBounds={showTextInteractionBounds}
                onDownloadAlphaChannels={() => void downloadAlphaChannels()}
                onShowExactBoundsChange={changeExactBounds}
                onShowTextInteractionBoundsChange={setShowTextInteractionBounds}
              />
            </TabsSubtlePanel>
            <TabsSubtlePanel idPrefix="build-workflow" index={1} selectedIndex={workflow}>
              <TemplateManager
                inventoryStorageMode={inventoryStorageMode}
                onApplyEdit={() => void applyTemplateEdit()}
                onBeginEditing={() => void beginTemplateEditing()}
                onCancelEdit={cancelTemplateEdit}
                onDeleteTemplate={() => void removeSelectedTemplate()}
                onExportTemplate={() => void exportTemplate()}
                onImportTemplate={(event) => void importTemplate(event)}
                onLoadTemplate={() => void loadSelectedTemplate()}
                onSelectTemplate={selectTemplate}
                officialTemplates={editorTemplateCatalog}
                originStorage={originStorage}
                referenceStorageMode={referenceLibrary.storageMode}
                selectedTemplateId={selectedTemplateId}
                selectedTemplateIsUser={selectedTemplateIsUser}
                selectedTemplateName={selectedTemplateName}
                selectedTemplateVersion={selectedTemplateVersion}
                storedTemplate={storedTemplate}
                storedTemplates={storedTemplates}
                templateBundleLoaded={templateBundleMatchesSelection}
                templateCacheBytes={templateCacheBytes}
                templateDocumentBusy={templateDocumentBusy}
                templateDocumentError={templateDocumentError}
                templateDraft={templateDraft}
                templateEditorOpen={templateEditorOpen}
                templateLoadError={templateLoadError}
                templateLoadProgress={templateLoadProgress}
                templateLoading={templateLoading}
                templateStorageError={templateStorageError}
                templateStorageMode={templateStorageMode}
                templateTransferAvailable={templateTransferAvailable}
                onTemplateDraftChange={setTemplateDraft}
              />
            </TabsSubtlePanel>
            <TabsSubtlePanel idPrefix="build-workflow" index={2} selectedIndex={workflow}>
              <ExportToolbar controller={controller} />
            </TabsSubtlePanel>
            <TabsSubtlePanel idPrefix="build-workflow" index={3} selectedIndex={workflow}>
              <ReferenceComparison
                comparisonMode={controller.comparisonMode}
                onAddFiles={referenceLibrary.addFiles}
                onChangeComparisonMode={controller.changeComparisonMode}
                onChangeReferenceOpacity={controller.changeReferenceOpacity}
                onDeleteSelected={referenceLibrary.deleteSelected}
                onResetTransform={referenceLibrary.resetTransform}
                onSelectIndex={referenceLibrary.setSelectedIndex}
                onSetTransform={referenceLibrary.setTransform}
                referenceOpacity={controller.referenceOpacity}
                references={referenceLibrary.references}
                selectedIndex={referenceLibrary.selectedIndex}
                settingsError={controller.settingsStorageError ?? referenceLibrary.settingsError}
                storageError={referenceLibrary.storageError}
                storageMode={referenceLibrary.storageMode}
              />
            </TabsSubtlePanel>
            <TabsSubtlePanel idPrefix="build-workflow" index={4} selectedIndex={workflow}>
              <BuildGuide />
            </TabsSubtlePanel>
          </div>
        </div>
        <div className="min-h-0">
          <CardPreview
            artworkWorkspace={
              shouldRenderArtworkWorkspace(
                controller.card.artwork,
                controller.presentationOverrides.artworkTransforms?.[artworkConfig.transformId],
              )
                ? {
                    artwork: controller.card.artwork,
                    mask: controller.artworkMask,
                    maskChannel: artworkConfig.maskChannel,
                    processedMaskBusy: controller.processedArtworkBusy,
                    getProcessedMaskPixels: controller.getProcessedArtworkMaskPixels,
                    processedMaskRevision: controller.processedArtworkRevision,
                    artworkEffectsError: controller.artworkEffectsError,
                    onRetryArtworkEffects: controller.retryArtworkEffects,
                    onMaskChange: controller.setArtworkMask,
                    onMaskComplete: controller.completeArtworkMask,
                    onSelectedPinChange: setArtworkSelectedPinId,
                    pinSize: artworkPinSize,
                    selectedPinId: artworkSelectedPinId,
                    tool: artworkTool,
                  }
                : undefined
            }
            controller={controller}
            manifest={showExactBounds ? exactAnalysis?.manifest : undefined}
            showExactBounds={showExactBounds}
            onFocusField={focusField}
            onRenderMetadata={acceptRenderMetadata}
            showTextInteractionBounds={showTextInteractionBounds}
          />
        </div>
      </div>
    </main>
  )
}
