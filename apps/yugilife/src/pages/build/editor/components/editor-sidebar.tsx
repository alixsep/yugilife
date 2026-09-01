import { useMemo } from "react"

import { Download, Eye, EyeOff, RotateCcw, TriangleAlert, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { CheckboxGroup, CheckboxItem } from "@/components/ui/checkbox-group"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DashedBorder } from "@/components/ui/dashed-border"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { useShape } from "@/lib/shape-context"
import { cn } from "@/lib/utils"

import { CardFieldInput } from "./card-field-input"
import {
  LeadingAuthoredLineFitToggle,
  TextCompressionControl,
  TextSizeControl,
} from "./editor-text-controls"

import type { useBuildController } from "../../page/use-build-controller"
import type { ReactNode } from "react"

interface EditorSidebarProps {
  alphaExportBusy: boolean
  alphaExportReady: boolean
  controller: ReturnType<typeof useBuildController>
  exactBoundsBusy: boolean
  onDownloadAlphaChannels: () => void
  onShowExactBoundsChange: (visible: boolean) => void
  onShowTextInteractionBoundsChange: (visible: boolean) => void
  showExactBounds: boolean
  showTextInteractionBounds: boolean
}

const fieldPriority = new Map([
  ["name", 0],
  ["cardVariant", 1],
  ["attribute", 2],
])

function EditorSection({
  children,
  description,
  title,
}: {
  children: ReactNode
  description?: string
  title: string
}) {
  return (
    <section className="border-border grid gap-4 border-b p-4 last:border-b-0">
      <div className="grid gap-0.5">
        <h2 className="text-title font-medium">{title}</h2>
        {description && <p className="text-caption text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}

export function EditorSidebar({
  alphaExportBusy,
  alphaExportReady,
  controller,
  exactBoundsBusy,
  onDownloadAlphaChannels,
  onShowExactBoundsChange,
  onShowTextInteractionBoundsChange,
  showExactBounds,
  showTextInteractionBounds,
}: EditorSidebarProps) {
  const {
    activeDefaultLayerVisibility,
    activeLayerGroups,
    activeOverrides,
    activePresetTargets,
    automaticCardFields,
    card,
    cardFields,
    clearActiveOverride,
    clearAllPresentationOverrides,
    compressibleText,
    debugLoggingEnabled,
    defaultPresentation,
    fittedText,
    layers,
    mode,
    presentation,
    presentationOverrides,
    presetOverrides,
    setAllLayers,
    setDebugLoggingEnabled,
    setField,
    setLayer,
    setMode,
    setPresetOverride,
    setTextFitProfile,
    setTextTypography,
  } = controller
  const shape = useShape()
  const orderedFields = useMemo(
    () =>
      [...cardFields].sort(
        (left, right) => (fieldPriority.get(left.name) ?? 3) - (fieldPriority.get(right.name) ?? 3),
      ),
    [cardFields],
  )
  const automaticFieldNames = useMemo(
    () => new Set(automaticCardFields.map(({ name }) => name)),
    [automaticCardFields],
  )
  const orderedAutomaticFields = useMemo(
    () => orderedFields.filter(({ name }) => automaticFieldNames.has(name)),
    [automaticFieldNames, orderedFields],
  )
  const orderedAdvancedFields = useMemo(
    () => orderedFields.filter(({ name }) => !automaticFieldNames.has(name)),
    [automaticFieldNames, orderedFields],
  )
  const renderField = (field: (typeof cardFields)[number]) => {
    const wide =
      field.name === "name" ||
      field.kind === "image" ||
      field.kind === "multiline" ||
      field.kind === "text-list"
    return (
      <div
        className={wide ? "min-w-0 sm:col-span-2" : "min-w-0"}
        data-card-field={field.name}
        key={field.name}
      >
        <CardFieldInput field={field} value={card[field.name]} onChange={setField} />
        {field.automaticFitLayer && (
          <div className="mt-2 grid gap-2">
            <TextSizeControl
              label={`${field.label} size`}
              layerId={field.automaticFitLayer}
              presentation={presentation}
              setTextFitProfile={setTextFitProfile}
            />
            {mode === "automatic" && (
              <LeadingAuthoredLineFitToggle
                defaultPresentation={defaultPresentation}
                layerId={field.automaticFitLayer}
                presentation={presentation}
                setTextTypography={setTextTypography}
                value={card[field.name]}
              />
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <aside className="grid content-start" aria-label="Card editor">
      {activeOverrides.length > 0 && (
        <div
          aria-live="polite"
          className={cn(
            "bg-warning-light relative mx-4 mt-4 overflow-hidden px-3 py-2",
            shape.container,
          )}
          role="status"
        >
          <DashedBorder className="text-warning" />
          <div className="grid min-w-0 gap-0.5">
            <div className="flex min-w-0 items-center gap-2">
              <TriangleAlert aria-hidden="true" className="text-warning size-4 flex-none" />
              <p className="text-body min-w-0 font-medium">Custom settings are active</p>
            </div>
            <p className="text-caption">
              {activeOverrides.length === 1
                ? "One presentation choice is taking priority over the template defaults."
                : `${activeOverrides.length} presentation choices are taking priority over the template defaults.`}
            </p>
          </div>
        </div>
      )}

      <EditorSection title="Card details" description="Everything printed on the card.">
        <div className="grid grid-cols-1 gap-x-3 gap-y-4 sm:grid-cols-2">
          {orderedAutomaticFields.map(renderField)}
        </div>
      </EditorSection>

      <section className="border-border grid gap-4 border-b p-4 last:border-b-0">
        <div className="flex items-start justify-between gap-4">
          <div className="grid min-w-0 gap-0.5">
            <div className="flex items-center gap-3">
              <h2 className="text-title font-medium">Advanced mode</h2>
              <Switch
                checked={mode === "advanced"}
                hideLabel
                label="Advanced mode"
                onToggle={() => setMode(mode === "advanced" ? "automatic" : "advanced")}
              />
            </div>
            <p className="text-caption text-muted-foreground">
              Control typography, appearance, and individual layers when the automatic choices need
              adjustment.
            </p>
          </div>
          <Switch
            checked={debugLoggingEnabled}
            className={mode === "advanced" ? undefined : "hidden"}
            label="Diagnostics"
            onToggle={() => setDebugLoggingEnabled(!debugLoggingEnabled)}
          />
        </div>

        {activeOverrides.length > 0 && (
          <div className="border-border grid gap-3 border-t pt-4">
            <div className="grid gap-0.5">
              <h3 className="text-subtitle font-medium">Active overrides</h3>
              <p className="text-caption text-muted-foreground">
                These choices are applied on top of the template defaults.
              </p>
            </div>
            <ConfirmDialog
              confirmLabel={`Reset ${activeOverrides.length} overrides`}
              description="This returns every manual presentation setting to the template defaults."
              title="Reset advanced overrides?"
              onConfirm={clearAllPresentationOverrides}
              trigger={
                <Button className="w-full" leadingIcon={RotateCcw} variant="tertiary">
                  Reset all overrides
                </Button>
              }
            />
            <ul className="grid gap-1">
              {activeOverrides.map((override) => (
                <li
                  className={cn("flex min-w-0 items-center gap-2 px-2 py-1.5", shape.item)}
                  key={override.id}
                >
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <span className="text-body text-foreground">{override.label}</span>
                    <span className="text-caption text-muted-foreground break-words">
                      {override.value}
                    </span>
                  </div>
                  <Button
                    aria-label={`Clear ${override.label}`}
                    size="icon-compact"
                    variant="ghost"
                    onClick={() => clearActiveOverride(override)}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {mode === "advanced" ? (
          <>
            <div className="border-border grid gap-3 border-t pt-4">
              <h3 className="text-subtitle font-medium">Render inspection</h3>
              <Switch
                checked={showTextInteractionBounds}
                label="Show text interaction boxes"
                onToggle={() => onShowTextInteractionBoundsChange(!showTextInteractionBounds)}
              />
              <Switch
                checked={showExactBounds}
                label="Show exact bounding boxes"
                onToggle={() => onShowExactBoundsChange(!showExactBounds)}
              />
              {exactBoundsBusy && (
                <p className="text-caption text-muted-foreground" role="status">
                  Preparing exact bounds…
                </p>
              )}
              <Button
                className="w-full"
                disabled={!alphaExportReady}
                leadingIcon={Download}
                loading={alphaExportBusy}
                variant="tertiary"
                onClick={onDownloadAlphaChannels}
              >
                Download alpha channels
              </Button>
            </div>

            {orderedAdvancedFields.length > 0 && (
              <div className="grid grid-cols-1 gap-x-3 gap-y-4 sm:grid-cols-2">
                {orderedAdvancedFields.map(renderField)}
              </div>
            )}

            {activePresetTargets.length > 0 && (
              <div className="border-border grid gap-3 border-t pt-4">
                <h3 className="text-subtitle font-medium">Appearance</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {activePresetTargets.map(({ label, presets, target }) => (
                    <label className="text-body grid gap-1.5" key={target}>
                      {label}
                      <Select
                        value={presetOverrides[target] ?? presentation.presets[target] ?? ""}
                        onValueChange={(value) => setPresetOverride(target, value)}
                      >
                        <SelectTrigger className="w-full" placeholder="Original texture" />
                        <SelectContent>
                          {presets.map((preset, index) => (
                            <SelectItem index={index} key={preset} value={preset}>
                              {preset}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {(fittedText.length > 0 || compressibleText.length > 0) && (
              <div className="border-border grid gap-4 border-t pt-4">
                <h3 className="text-subtitle font-medium">Typography</h3>
                {fittedText.map(({ fitProfileId, layerId, styleId, styleLabel, typography }) => {
                  const profiles = typography.fitProfiles ?? []
                  const selected = Math.max(
                    0,
                    profiles.findIndex(({ id }) => id === fitProfileId) + 1,
                  )
                  const labels = ["Automatic", ...profiles.map(({ label }) => label)]
                  return (
                    <Slider
                      formatValue={(value) => labels[value] ?? "Automatic"}
                      key={`${layerId}:${styleId}`}
                      label={styleLabel}
                      max={profiles.length}
                      min={0}
                      step={1}
                      value={selected}
                      variant="scrubber"
                      onChange={(value: number) =>
                        setTextFitProfile(layerId, styleId, profiles[value - 1]?.id)
                      }
                    />
                  )
                })}
                {compressibleText.map(({ layerId, styleId, styleLabel, typography }) => (
                  <TextCompressionControl
                    defaultTypography={defaultPresentation.text[layerId]?.typography ?? typography}
                    key={`compression:${layerId}:${styleId}`}
                    layerId={layerId}
                    setTextTypography={setTextTypography}
                    styleId={styleId}
                    styleLabel={styleLabel}
                    typography={typography}
                    usesOverride={
                      presentationOverrides.textTypography?.[layerId]?.[styleId]
                        ?.maxAutoCompressionX !== undefined
                    }
                  />
                ))}
              </div>
            )}

            <div className="border-border grid gap-3 border-t pt-4">
              <h3 className="text-subtitle font-medium">Layers</h3>
              <div className="flex gap-1">
                <Button leadingIcon={Eye} variant="ghost" onClick={() => setAllLayers(true)}>
                  Show all
                </Button>
                <Button leadingIcon={EyeOff} variant="ghost" onClick={() => setAllLayers(false)}>
                  Hide all
                </Button>
              </div>
              <div className="grid gap-3">
                {activeLayerGroups.map((group) => {
                  const checked = new Set(
                    group.layers.flatMap(({ id }, index) =>
                      (layers[id] ??
                      presentation.layerVisibility[id] ??
                      activeDefaultLayerVisibility[id] ??
                      false)
                        ? [index]
                        : [],
                    ),
                  )
                  return (
                    <div className="grid gap-1" key={group.label}>
                      <p className="text-caption text-muted-foreground px-2">{group.label}</p>
                      <CheckboxGroup checkedIndices={checked} className="w-full">
                        {group.layers.map(({ id, label }, index) => (
                          <CheckboxItem
                            checked={checked.has(index)}
                            index={index}
                            key={id}
                            label={label}
                            onToggle={() => setLayer(id, !checked.has(index))}
                          />
                        ))}
                      </CheckboxGroup>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        ) : (
          <p className="text-caption text-muted-foreground">
            Automatic mode is active. The template is balancing type, textures, and layer choices as
            the card changes.
          </p>
        )}
      </section>
    </aside>
  )
}
