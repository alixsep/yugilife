import { RotateCcw, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { ImageDropzone } from "@/components/ui/file-upload"
import { NumberInput } from "@/components/ui/number-input"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"

import type { ReferenceImage } from "./reference-library"
import type { ComparisonMode, ReferenceTransform } from "./reference-settings"

type StorageMode = "indexeddb" | "memory"

interface PrecisionControlProps {
  label: string
  min?: number
  step: number
  unit: string
  value: number
  onChange: (value: number) => void
}

function PrecisionControl({ label, min, onChange, step, unit, value }: PrecisionControlProps) {
  const update = (next: number) => onChange(Math.max(min ?? -Infinity, Number(next.toFixed(4))))

  return (
    <Field>
      <FieldLabel>
        {label} ({unit})
      </FieldLabel>
      <NumberInput
        min={min}
        step={step}
        value={value}
        onValueChange={(next) => {
          if (next !== null) update(next)
        }}
      />
    </Field>
  )
}

interface ReferenceComparisonProps {
  comparisonMode: ComparisonMode
  onAddFiles: (files: File[]) => void
  onChangeComparisonMode: (mode: ComparisonMode) => void
  onChangeReferenceOpacity: (opacity: number) => void
  onDeleteSelected: () => void
  onResetTransform: () => void
  onSelectIndex: (index: number) => void
  onSetTransform: (property: keyof ReferenceTransform, value: number) => void
  referenceOpacity: number
  references: readonly ReferenceImage[]
  selectedIndex: number
  settingsError: string | undefined
  storageError: string | undefined
  storageMode: StorageMode
}

export function ReferenceComparison({
  comparisonMode,
  onAddFiles,
  onChangeComparisonMode,
  onChangeReferenceOpacity,
  onDeleteSelected,
  onResetTransform,
  onSelectIndex,
  onSetTransform,
  referenceOpacity,
  references,
  selectedIndex,
  settingsError,
  storageError,
}: ReferenceComparisonProps) {
  const reference = references[selectedIndex]

  return (
    <section className="grid gap-5 p-4">
      <div className="grid gap-1">
        <h2 className="text-title font-medium">References</h2>
        <p className="text-caption text-muted-foreground">
          Add finished cards or source images to compare against the live preview.
        </p>
      </div>
      <ImageDropzone className="w-full" multiple onFilesSelected={onAddFiles}>
        Drop reference images here or click to browse
      </ImageDropzone>

      {references.length > 0 && (
        <div className="grid gap-4">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
            <Field className="min-w-0">
              <FieldLabel>Reference</FieldLabel>
              <Select
                value={String(selectedIndex)}
                onValueChange={(value) => onSelectIndex(Number(value))}
              >
                <SelectTrigger className="w-full" />
                <SelectContent>
                  {references.map((item, index) => (
                    <SelectItem index={index} key={item.id} value={String(index)}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field className="min-w-0">
              <FieldLabel>Comparison</FieldLabel>
              <Select
                value={comparisonMode}
                onValueChange={(value) => onChangeComparisonMode(value as ComparisonMode)}
              >
                <SelectTrigger className="w-full" />
                <SelectContent>
                  <SelectItem index={0} value="overlay">
                    Overlay
                  </SelectItem>
                  <SelectItem index={1} value="side-by-side">
                    Side by side
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          {comparisonMode === "overlay" && (
            <Slider
              formatValue={(value) => `${value}%`}
              label="Opacity"
              value={referenceOpacity}
              variant="scrubber"
              onChange={onChangeReferenceOpacity}
            />
          )}

          {reference && comparisonMode === "overlay" && (
            <div className="border-border grid gap-4 border-t pt-4">
              <div className="flex items-center justify-between gap-3">
                <div className="grid gap-0.5">
                  <h3 className="text-subtitle font-medium">Alignment</h3>
                  <p className="text-caption text-muted-foreground">
                    Position and stretch the overlay independently on each axis.
                  </p>
                </div>
                <ConfirmDialog
                  confirmLabel="Reset alignment"
                  description="This returns position, scale, and rotation to their original values."
                  title="Reset reference alignment?"
                  onConfirm={onResetTransform}
                  trigger={
                    <Button leadingIcon={RotateCcw} variant="ghost">
                      Reset
                    </Button>
                  }
                />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
                <PrecisionControl
                  label="Position X"
                  step={0.1}
                  unit="px"
                  value={reference.transform.x}
                  onChange={(value) => onSetTransform("x", value)}
                />
                <PrecisionControl
                  label="Position Y"
                  step={0.1}
                  unit="px"
                  value={reference.transform.y}
                  onChange={(value) => onSetTransform("y", value)}
                />
                <PrecisionControl
                  label="Scale X"
                  min={0.01}
                  step={0.01}
                  unit="%"
                  value={reference.transform.scaleX}
                  onChange={(value) => onSetTransform("scaleX", value)}
                />
                <PrecisionControl
                  label="Scale Y"
                  min={0.01}
                  step={0.01}
                  unit="%"
                  value={reference.transform.scaleY}
                  onChange={(value) => onSetTransform("scaleY", value)}
                />
                <PrecisionControl
                  label="Rotation"
                  step={0.01}
                  unit="°"
                  value={reference.transform.rotation}
                  onChange={(value) => onSetTransform("rotation", value)}
                />
              </div>
            </div>
          )}

          <ConfirmDialog
            confirmLabel="Remove reference"
            description={`“${reference?.name ?? "This reference"}” will be removed from this browser.`}
            title="Remove this reference?"
            onConfirm={onDeleteSelected}
            trigger={
              <Button className="w-full" leadingIcon={Trash2} variant="tertiary">
                Remove reference
              </Button>
            }
          />
        </div>
      )}

      {(storageError || settingsError) && <FieldError>{storageError ?? settingsError}</FieldError>}
    </section>
  )
}
