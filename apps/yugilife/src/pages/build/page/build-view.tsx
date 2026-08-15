import { useState } from "react"

import { ArrowLeft, CircleHelp, Download, Images, LayoutTemplate, Pencil } from "lucide-react"
import { Link } from "react-router"

import { AppNavigation } from "@/components/app-navigation"
import { Button } from "@/components/ui/button"
import { TabsSubtle, TabsSubtleItem, TabsSubtlePanel } from "@/components/ui/tabs-subtle"

import { EditorSidebar } from "../editor/components/editor-sidebar"
import { ReferenceComparison } from "../references/reference-comparison"
import { TemplateManager } from "../templates/template-manager"

import { BuildGuide } from "./build-guide"
import { CardPreview } from "./card-preview"
import { ExportToolbar } from "./export-toolbar"
import { editorTemplateCatalog } from "./use-build-controller"

import type { useBuildController } from "./use-build-controller"

interface BuildViewProps {
  controller: ReturnType<typeof useBuildController>
}

export function BuildView({ controller }: BuildViewProps) {
  const [workflow, setWorkflow] = useState(0)
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
        <div className="border-border bg-card shadow-surface-2 grid max-w-md gap-3 rounded-xl border p-5">
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
          {(newCardError || exportError || inventorySaveError || documentTransferError) && (
            <div
              className="bg-destructive-light text-destructive text-body rounded-lg px-3 py-2"
              role="alert"
            >
              {newCardError ?? exportError ?? inventorySaveError ?? documentTransferError}
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

          <div className="border-border bg-card shadow-surface-1 min-h-0 flex-1 overflow-y-auto rounded-xl border">
            <TabsSubtlePanel idPrefix="build-workflow" index={0} selectedIndex={workflow}>
              <EditorSidebar controller={controller} />
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
          <CardPreview controller={controller} />
        </div>
      </div>
    </main>
  )
}
