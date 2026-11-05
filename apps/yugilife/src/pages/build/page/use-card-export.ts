import { useMemo, useState } from "react"

import { exportCardToImage, exportCardToSvg, resolveRasterOutputDimensions } from "yugilife-core"

import { errorMessage } from "@/lib/utils"

import { migrateInventoryCardDocument } from "../../inventory/model/inventory-card-migration"
import { projectCardForRender } from "../editor/model/editor-config"
import { createInitialEditorDocument } from "../editor/model/editor-store"
import {
  maximumEditorDocumentBytes,
  parseEditorDocument,
  serializeEditorDocument,
} from "../editor/persistence/editor-document-io"
import { readStoredTemplate } from "../templates/template-storage"

import { readSelectedFile, safeFileName } from "./downloads"

import type { EditorDocumentState } from "../editor/model/editor-document"
import type { ChangeEvent } from "react"
import type {
  CardTemplate,
  CardTemplateBundle,
  RasterImageFormat,
  RasterOutputSize,
} from "yugilife-core"

export type ExportFormat = RasterImageFormat | "svg"
export type RasterSizeChoice = "0.5" | "1" | "2" | "4" | "8" | "height" | "width"

function rasterSizeForChoice(choice: RasterSizeChoice, customDimension: string) {
  if (choice === "1") return { valid: true, size: undefined }
  if (choice === "width" || choice === "height") {
    const dimension = Number(customDimension)
    if (!Number.isSafeInteger(dimension) || dimension <= 0) return { valid: false, size: undefined }
    const size: RasterOutputSize = choice === "width" ? { width: dimension } : { height: dimension }
    return { valid: true, size }
  }
  return { valid: true, size: { scale: Number(choice) } }
}

interface CardExportInput {
  readonly currentDocument: EditorDocumentState
  readonly download: (blob: Blob, fileName: string) => void
  readonly onDocumentImported: (document: EditorDocumentState) => void
  readonly plainCardName: string
  readonly processedMaskForDocument: (document: EditorDocumentState) => Promise<Blob | undefined>
  readonly syncTemplateStorageMode: () => void
  readonly template: CardTemplate
  readonly templateBundle: CardTemplateBundle | undefined
}

export function useCardExport({
  currentDocument,
  download,
  onDocumentImported,
  plainCardName,
  processedMaskForDocument,
  syncTemplateStorageMode,
  template,
  templateBundle,
}: CardExportInput) {
  const [exportError, setExportError] = useState<string>()
  const [exportFormat, setExportFormat] = useState<ExportFormat>("png")
  const [exporting, setExporting] = useState(false)
  const [rasterBackground, setRasterBackground] = useState("#ffffff")
  const [rasterCustomDimension, setRasterCustomDimension] = useState(() =>
    String(template.dimensions.width),
  )
  const [rasterQuality, setRasterQuality] = useState(92)
  const [rasterSizeChoice, setRasterSizeChoice] = useState<RasterSizeChoice>("1")
  const [documentTransferError, setDocumentTransferError] = useState<string>()
  const [documentTransferBusy, setDocumentTransferBusy] = useState(false)
  const fileName = safeFileName(plainCardName)

  const rasterOutputDimensions = useMemo(() => {
    const { size, valid } = rasterSizeForChoice(rasterSizeChoice, rasterCustomDimension)
    if (!valid) return undefined
    try {
      return resolveRasterOutputDimensions(template.dimensions, size)
    } catch {
      return undefined
    }
  }, [template.dimensions, rasterCustomDimension, rasterSizeChoice])

  async function downloadExport() {
    if (!templateBundle) return
    setExporting(true)
    setExportError(undefined)
    try {
      const { layers, presentationOverrides, presetOverrides } = currentDocument
      const renderOptions = {
        layers,
        presetOverrides,
        presentationOverrides,
        templateBundle,
      }
      const exportCard = projectCardForRender(
        currentDocument.card,
        currentDocument.mode,
        currentDocument.artworkMask,
        template,
        await processedMaskForDocument(currentDocument),
      )
      if (exportFormat === "svg") {
        const svg = await exportCardToSvg(exportCard, { ...renderOptions, title: plainCardName })
        download(new Blob([svg], { type: "image/svg+xml" }), `${fileName}.svg`)
        return
      }
      const { size, valid } = rasterSizeForChoice(rasterSizeChoice, rasterCustomDimension)
      if (!valid) throw new Error("Custom image size must be a positive whole number of pixels.")
      const image = await exportCardToImage(exportCard, {
        ...renderOptions,
        ...(exportFormat === "jpeg" ? { backgroundColor: rasterBackground } : {}),
        ...(exportFormat === "png" ? {} : { quality: rasterQuality / 100 }),
        format: exportFormat,
        size,
      })
      download(image, `${fileName}.${exportFormat === "jpeg" ? "jpg" : exportFormat}`)
    } catch (error) {
      setExportError(errorMessage(error))
    } finally {
      setExporting(false)
    }
  }

  async function transferDocument(task: () => Promise<void>) {
    setDocumentTransferBusy(true)
    setDocumentTransferError(undefined)
    try {
      await task()
    } catch (error) {
      setDocumentTransferError(errorMessage(error))
    } finally {
      setDocumentTransferBusy(false)
    }
  }

  async function downloadJson() {
    await transferDocument(async () => {
      const json = await serializeEditorDocument(currentDocument)
      download(new Blob([json], { type: "application/json" }), `${fileName}.json`)
    })
  }

  async function importJson(event: ChangeEvent<HTMLInputElement>) {
    await transferDocument(async () => {
      const file = readSelectedFile(event, maximumEditorDocumentBytes, "Editor documents")
      if (!file) return
      let document = parseEditorDocument(await file.text())
      if (document.templateId.startsWith("user/")) {
        const stored = await readStoredTemplate(document.templateId)
        syncTemplateStorageMode()
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
      onDocumentImported(document)
    })
  }

  return {
    documentTransferBusy,
    documentTransferError,
    downloadExport,
    downloadJson,
    exportError,
    exportFormat,
    exporting,
    importJson,
    rasterBackground,
    rasterCustomDimension,
    rasterOutputDimensions,
    rasterQuality,
    rasterSizeChoice,
    setExportFormat,
    setRasterBackground,
    setRasterCustomDimension,
    setRasterQuality,
    setRasterSizeChoice,
  }
}
