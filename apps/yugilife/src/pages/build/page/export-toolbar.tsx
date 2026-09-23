import { Braces, Download, FileDown, RotateCcw, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ColorPickerPopover } from "@/components/ui/color-picker"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DashedBorder } from "@/components/ui/dashed-border"
import { Field, FieldLabel } from "@/components/ui/field"
import { NumberInput } from "@/components/ui/number-input"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle"
import { useShape } from "@/lib/shape-context"
import { cn } from "@/lib/utils"

import type { ExportFormat, RasterSizeChoice, useBuildController } from "./use-build-controller"
import type { ChangeEvent } from "react"

interface ExportToolbarProps {
  controller: ReturnType<typeof useBuildController>
}

const formats: { label: string; value: ExportFormat }[] = [
  { label: "PNG", value: "png" },
  { label: "JPEG", value: "jpeg" },
  { label: "WebP", value: "webp" },
  { label: "SVG", value: "svg" },
]

const sizes: { label: string; value: RasterSizeChoice }[] = [
  { label: "Half size", value: "0.5" },
  { label: "Original", value: "1" },
  { label: "2×", value: "2" },
  { label: "4×", value: "4" },
  { label: "8×", value: "8" },
  { label: "Custom width", value: "width" },
  { label: "Custom height", value: "height" },
]

const formatNotes: Record<ExportFormat, string> = {
  png: "Lossless pixels with transparency. Best for editing and archival output.",
  jpeg: "Smaller photographs with a solid background and adjustable quality.",
  webp: "Compact modern image with transparency and adjustable quality.",
  svg: "Resolution-independent vector output for compatible design tools.",
}

export function ExportToolbar({ controller }: ExportToolbarProps) {
  const shape = useShape()
  const {
    activeEditorTemplate,
    documentTransferBusy,
    downloadExport,
    downloadJson,
    exportFormat,
    exporting,
    importJson,
    rasterBackground,
    rasterCustomDimension,
    rasterOutputDimensions,
    rasterQuality,
    rasterSizeChoice,
    resetEditor,
    setExportFormat,
    setRasterBackground,
    setRasterCustomDimension,
    setRasterQuality,
    setRasterSizeChoice,
    templateBundle,
  } = controller
  const formatIndex = Math.max(
    0,
    formats.findIndex(({ value }) => value === exportFormat),
  )
  const templateDimensions = activeEditorTemplate.dimensions
  const outputDimensions = rasterOutputDimensions ?? templateDimensions
  const hasOutputDimensions = exportFormat === "svg" || Boolean(rasterOutputDimensions)

  return (
    <section className="grid gap-5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <h2 className="text-title font-medium">Export</h2>
          <p className="text-caption text-muted-foreground">
            Prepare the finished card for sharing.
          </p>
        </div>
        <ConfirmDialog
          confirmLabel="Reset card"
          description="This replaces the current fields and presentation settings with a blank card."
          title="Reset the current card?"
          onConfirm={resetEditor}
          trigger={
            <Button leadingIcon={RotateCcw} variant="ghost">
              Reset card
            </Button>
          }
        />
      </div>

      <div className={cn("bg-muted/50 grid gap-3 p-3", shape.container)}>
        <div className="flex items-start gap-3">
          <Braces className="mt-0.5 size-5 shrink-0" />
          <div className="grid gap-0.5">
            <h3 className="text-subtitle font-medium">Editable JSON project</h3>
            <p className="text-caption text-muted-foreground">
              Save every field and presentation choice, or continue from an existing project.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={documentTransferBusy || controller.artworkMaskPending}
            leadingIcon={FileDown}
            variant="secondary"
            onClick={() => void downloadJson()}
          >
            Download JSON
          </Button>
          <Button asChild disabled={documentTransferBusy} leadingIcon={Upload} variant="ghost">
            <label>
              Import JSON
              <input
                accept="application/json,.json"
                className="sr-only"
                disabled={documentTransferBusy}
                type="file"
                onChange={(event: ChangeEvent<HTMLInputElement>) => void importJson(event)}
              />
            </label>
          </Button>
        </div>
      </div>

      <section
        className="border-border flex flex-col gap-4 border-t pt-4 sm:flex-row"
        aria-labelledby="export-size-title"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="grid gap-2">
            <h3 className="text-subtitle font-medium">File format</h3>
            <TabsSubtle
              idPrefix="export-format"
              selectedIndex={formatIndex}
              onSelect={(index) => {
                const format = formats[index]?.value
                if (format) setExportFormat(format)
              }}
            >
              {formats.map((format, index) => (
                <TabsSubtleItem index={index} key={format.value} label={format.label} />
              ))}
            </TabsSubtle>
            <p className="text-caption text-muted-foreground">{formatNotes[exportFormat]}</p>
          </div>

          <div className="flex flex-col gap-0.5">
            <h3 id="export-size-title" className="text-subtitle font-medium">
              Output size
            </h3>
            <p className="text-caption text-muted-foreground">
              Choose a preset or set one dimension and keep the card proportions.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <Field disabled={exportFormat === "svg"}>
              <FieldLabel>Preset</FieldLabel>
              <Select
                disabled={exportFormat === "svg"}
                value={rasterSizeChoice}
                onValueChange={(value) => setRasterSizeChoice(value as RasterSizeChoice)}
              >
                <SelectTrigger className="w-full" />
                <SelectContent>
                  {sizes.map((size, index) => (
                    <SelectItem index={index} key={size.value} value={size.value}>
                      {size.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {(rasterSizeChoice === "width" || rasterSizeChoice === "height") &&
              exportFormat !== "svg" && (
                <Field>
                  <FieldLabel>{rasterSizeChoice === "width" ? "Width" : "Height"}</FieldLabel>
                  <NumberInput
                    min={1}
                    step={1}
                    value={Number(rasterCustomDimension) || null}
                    onValueChange={(value) =>
                      setRasterCustomDimension(value === null ? "" : String(value))
                    }
                  />
                </Field>
              )}
          </div>

          {(exportFormat === "jpeg" || exportFormat === "webp") && (
            <div className="grid gap-2">
              <Slider
                formatValue={(value) => `${value}%`}
                label="Quality"
                value={rasterQuality}
                variant="scrubber"
                onChange={setRasterQuality}
              />
              <p className="text-caption text-muted-foreground">
                Higher values preserve more detail and produce larger files.
              </p>
            </div>
          )}

          {exportFormat === "jpeg" && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-body">Background</span>
              <ColorPickerPopover
                triggerLabel="Background"
                triggerShowValue={false}
                value={rasterBackground}
                onValueChange={setRasterBackground}
              />
            </div>
          )}
        </div>

        <div className="flex shrink flex-col items-center gap-4">
          <div
            className={cn(
              "text-muted-foreground relative mx-auto flex w-full max-w-32 items-center justify-center overflow-hidden bg-transparent",
              shape.container,
              exportFormat === "svg" && "opacity-60",
            )}
            style={{ aspectRatio: `${templateDimensions.width} / ${templateDimensions.height}` }}
          >
            <DashedBorder className="text-border" />
            <div className="grid gap-0.5 px-2 text-center">
              <span className="text-caption">Output</span>
              <span className="text-body text-foreground font-medium">
                {hasOutputDimensions
                  ? `${outputDimensions.width} × ${outputDimensions.height}`
                  : "Enter a size"}
              </span>
              <span className="text-caption">pixels</span>
            </div>
          </div>
          <Button
            className="max-w-fit"
            disabled={
              controller.artworkMaskPending ||
              !templateBundle ||
              (exportFormat !== "svg" && !rasterOutputDimensions)
            }
            leadingIcon={Download}
            loading={exporting}
            onClick={() => void downloadExport()}
          >
            Download {exportFormat.toUpperCase()}
          </Button>
        </div>
      </section>
    </section>
  )
}
