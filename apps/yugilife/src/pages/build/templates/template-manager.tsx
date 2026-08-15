import { Check, Download, FileJson, HardDrive, Trash2, Upload, X } from "lucide-react"

import {
  AccordionContent,
  AccordionGroup,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"

import { templateManagerActionLabel } from "./template-manager-actions"

import type {
  OriginStorageEstimate,
  StoredTemplateRecord,
  TemplateStorageMode,
} from "./template-storage"
import type { ChangeEvent } from "react"
import type { TemplateLoadProgress } from "yugilife-templates"

interface OfficialTemplateDescriptor {
  id: string
  name: string
  version: string
}

type StorageMode = "indexeddb" | "memory"

interface TemplateManagerProps {
  inventoryStorageMode: StorageMode
  onApplyEdit: () => void
  onBeginEditing: () => void
  onCancelEdit: () => void
  onDeleteTemplate: () => void
  onExportTemplate: () => void
  onImportTemplate: (event: ChangeEvent<HTMLInputElement>) => void
  onLoadTemplate: () => void
  onSelectTemplate: (templateId: string) => void
  officialTemplates: readonly OfficialTemplateDescriptor[]
  originStorage: OriginStorageEstimate
  referenceStorageMode: StorageMode
  selectedTemplateId: string
  selectedTemplateIsUser: boolean
  selectedTemplateName: string | undefined
  selectedTemplateVersion: string | undefined
  storedTemplate: StoredTemplateRecord | undefined
  storedTemplates: readonly StoredTemplateRecord[]
  templateBundleLoaded: boolean
  templateCacheBytes: number
  templateDocumentBusy: boolean
  templateDocumentError: string | undefined
  templateDraft: string
  templateEditorOpen: boolean
  templateLoadError: string | undefined
  templateLoadProgress: TemplateLoadProgress | undefined
  templateLoading: boolean
  templateStorageError: string | undefined
  templateStorageMode: TemplateStorageMode
  templateTransferAvailable: boolean
  onTemplateDraftChange: (draft: string) => void
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length)
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 1 ? 1 : 2)} ${units[exponent - 1] ?? "TB"}`
}

function formatOriginStorage({ quota, usage }: OriginStorageEstimate) {
  if (usage === undefined) return "Browser estimate unavailable"
  if (quota === undefined) return `${formatBytes(usage)} used`
  return `${formatBytes(usage)} of ${formatBytes(quota)} used`
}

export function TemplateManager({
  inventoryStorageMode,
  onApplyEdit,
  onBeginEditing,
  onCancelEdit,
  onDeleteTemplate,
  onExportTemplate,
  onImportTemplate,
  onLoadTemplate,
  onSelectTemplate,
  officialTemplates,
  originStorage,
  referenceStorageMode,
  selectedTemplateId,
  selectedTemplateIsUser,
  selectedTemplateName,
  selectedTemplateVersion,
  storedTemplate,
  storedTemplates,
  templateCacheBytes,
  templateBundleLoaded,
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
  onTemplateDraftChange,
}: TemplateManagerProps) {
  const userTemplates = storedTemplates.filter(({ source }) => source === "user")
  const loadLabel = templateManagerActionLabel({
    hasError: templateLoadError !== undefined,
    loaded: templateBundleLoaded,
    loading: templateLoading,
    selectedTemplateVersion,
    storedTemplate,
  })

  return (
    <section className="grid gap-6 p-4">
      <div className="grid min-w-0 gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-title truncate font-medium">
            {selectedTemplateName ?? "Card template"}
          </h2>
          {selectedTemplateVersion && (
            <span className="bg-muted text-muted-foreground text-caption shrink-0 rounded-full px-2 py-1">
              v{selectedTemplateVersion}
            </span>
          )}
        </div>
        <p className="text-caption text-muted-foreground">
          Choose the visual system that controls the card’s layers, type, and assets.
        </p>
      </div>

      <div className="grid gap-3">
        <Field className="min-w-0">
          <FieldLabel>Active template</FieldLabel>
          <Select value={selectedTemplateId} onValueChange={onSelectTemplate}>
            <SelectTrigger className="w-full" placeholder="Choose a template" />
            <SelectContent>
              {officialTemplates.map((template, index) => (
                <SelectItem index={index} key={template.id} value={template.id}>
                  {template.name}
                </SelectItem>
              ))}
              {userTemplates.map((template, index) => (
                <SelectItem
                  index={officialTemplates.length + index}
                  key={template.id}
                  value={template.id}
                >
                  {template.bundle.manifest.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {!templateBundleLoaded && (
          <Button
            className="w-full"
            disabled={templateLoading || templateDocumentBusy}
            leadingIcon={Download}
            loading={templateLoading}
            onClick={onLoadTemplate}
          >
            {loadLabel}
          </Button>
        )}
      </div>

      {templateLoading && templateLoadProgress?.phase === "downloading" && (
        <progress
          aria-label="Downloading template assets"
          className="h-1 w-full accent-(--focus-ring)"
          max={templateLoadProgress.total}
          value={templateLoadProgress.loaded}
        />
      )}

      <div className="border-border grid gap-3 border-t pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="grid gap-0.5">
            <h3 className="text-subtitle font-medium">Template tools</h3>
            <p className="text-caption text-muted-foreground">
              {selectedTemplateIsUser ? "Custom template" : "Official template"} ·{" "}
              {templateBundleLoaded ? "ready to use" : "assets not loaded"}
            </p>
          </div>
          {storedTemplate && (
            <span className="text-caption text-muted-foreground shrink-0">
              {formatBytes(storedTemplate.sizeBytes)}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            asChild
            className="w-full"
            leadingIcon={Upload}
            variant="tertiary"
            disabled={templateDocumentBusy || templateLoading}
          >
            <label>
              Import
              <input
                accept="application/json,.json"
                className="sr-only"
                disabled={templateDocumentBusy || templateLoading}
                type="file"
                onChange={onImportTemplate}
              />
            </label>
          </Button>
          <Button
            className="w-full"
            disabled={templateDocumentBusy || templateLoading || !templateTransferAvailable}
            leadingIcon={Download}
            variant="tertiary"
            onClick={onExportTemplate}
          >
            Export
          </Button>
          <Button
            className="w-full"
            disabled={templateDocumentBusy || templateLoading || !templateTransferAvailable}
            leadingIcon={FileJson}
            variant="tertiary"
            onClick={onBeginEditing}
          >
            {selectedTemplateIsUser ? "Edit source" : "Make a copy"}
          </Button>
          {storedTemplate && (
            <ConfirmDialog
              confirmLabel={selectedTemplateIsUser ? "Delete template" : "Clear cached assets"}
              description={
                selectedTemplateIsUser
                  ? "This removes the custom template and its locally stored assets from this browser."
                  : "This removes the downloaded template assets. You can download them again later."
              }
              disabled={templateLoading || templateDocumentBusy}
              title={selectedTemplateIsUser ? "Delete this template?" : "Clear cached assets?"}
              onConfirm={onDeleteTemplate}
              trigger={
                <Button className="w-full" leadingIcon={Trash2} variant="tertiary">
                  {selectedTemplateIsUser ? "Delete template" : "Clear cache"}
                </Button>
              }
            />
          )}
        </div>
      </div>

      <AccordionGroup className="w-full" type="single" collapsible>
        <AccordionItem index={0} value="template-details">
          <AccordionTrigger>Storage and version details</AccordionTrigger>
          <AccordionContent>
            <div className="text-caption text-muted-foreground grid gap-2 py-3">
              <div className="text-foreground flex items-center gap-2 font-medium">
                <HardDrive className="size-4" /> Local browser storage
              </div>
              <p>
                Selected: {selectedTemplateName ?? selectedTemplateId} · version{" "}
                {selectedTemplateVersion ?? "unknown"}
              </p>
              <p>
                Template cache: {formatBytes(templateCacheBytes)} across {storedTemplates.length}{" "}
                template{storedTemplates.length === 1 ? "" : "s"}.
              </p>
              <p>
                Template data: {templateStorageMode === "indexeddb" ? "persistent" : "session only"}
                .
              </p>
              <p>
                Card data: {inventoryStorageMode === "indexeddb" ? "persistent" : "session only"}.
              </p>
              <p>
                References: {referenceStorageMode === "indexeddb" ? "persistent" : "session only"}.
              </p>
              <p>Origin storage: {formatOriginStorage(originStorage)}.</p>
              {storedTemplate && selectedTemplateVersion !== storedTemplate.version && (
                <p className="text-foreground">
                  Cached version {storedTemplate.version}; version {selectedTemplateVersion} is
                  available.
                </p>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      </AccordionGroup>

      {templateEditorOpen && (
        <div className="border-border grid gap-3 border-t pt-4">
          <Field>
            <FieldLabel>Template source</FieldLabel>
            <Textarea
              className="min-h-80 font-mono text-xs"
              disabled={templateDocumentBusy}
              value={templateDraft}
              onChange={(event) => onTemplateDraftChange(event.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Button disabled={templateDocumentBusy} leadingIcon={Check} onClick={onApplyEdit}>
              Apply changes
            </Button>
            <Button
              disabled={templateDocumentBusy}
              leadingIcon={X}
              variant="ghost"
              onClick={onCancelEdit}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {templateStorageError && <FieldError>{templateStorageError}</FieldError>}
      {templateLoadError && <FieldError>{templateLoadError}</FieldError>}
      {templateDocumentError && <FieldError>{templateDocumentError}</FieldError>}
    </section>
  )
}
