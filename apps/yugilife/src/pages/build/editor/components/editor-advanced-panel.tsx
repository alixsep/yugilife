import { useMemo } from "react"

import { Download, Eye, EyeOff, RotateCcw, X } from "lucide-react"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { CheckboxGroup, CheckboxItem } from "@/components/ui/checkbox-group"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useShape } from "@/lib/shape-context"
import { cn } from "@/lib/utils"

import { groupEditorTextStyles } from "../model/editor-text-styles"

import { TextCompressionControl, TextPaintControl, TextSizeControl } from "./editor-text-controls"

import type { useBuildController } from "../../page/use-build-controller"
import type { ReactNode } from "react"

type BuildController = ReturnType<typeof useBuildController>

interface EditorAdvancedPanelProps {
  alphaExportBusy: boolean
  alphaExportReady: boolean
  controller: BuildController
  exactBoundsBusy: boolean
  onDownloadAlphaChannels: () => void
  onShowExactBoundsChange: (visible: boolean) => void
  onShowTextInteractionBoundsChange: (visible: boolean) => void
  showExactBounds: boolean
  showTextInteractionBounds: boolean
}

/**
 * One collapsed category of advanced settings.
 *
 * The summary carries the category's current weight — how many choices depart from the template, or
 * how much it contains — so the collapsed list still answers "where did I change something?" without
 * expanding every category in turn.
 */
function AdvancedCategory({
  children,
  index,
  summary,
  title,
  value,
}: {
  children: ReactNode
  index: number
  summary?: string | undefined
  title: string
  value: string
}) {
  return (
    <AccordionItem index={index} value={value}>
      <AccordionTrigger>
        <span className="flex min-w-0 items-center justify-between gap-2">
          <span className="truncate">{title}</span>
          {summary && (
            <span className="text-caption text-muted-foreground shrink-0">{summary}</span>
          )}
        </span>
      </AccordionTrigger>
      <AccordionContent>
        <div className="text-foreground grid gap-3">{children}</div>
      </AccordionContent>
    </AccordionItem>
  )
}

/** A category reports what departs from the template when anything does, and its size otherwise. */
function categorySummary(changed: number, size: string) {
  return changed > 0 ? `${changed} changed` : size
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

/**
 * The presentation choices currently departing from the template, each individually clearable.
 *
 * Reachable in both editor modes: overrides persist across a switch back to Automatic, so the way
 * out of them must not require turning Advanced mode on again.
 */
export function ActiveOverridesList({
  activeOverrides,
  clearActiveOverride,
  clearAllPresentationOverrides,
}: Pick<
  BuildController,
  "activeOverrides" | "clearActiveOverride" | "clearAllPresentationOverrides"
>) {
  const shape = useShape()
  return (
    <div className="grid gap-3">
      <div className="grid gap-0.5">
        <h3 className="text-subtitle font-medium">Active overrides</h3>
        <p className="text-caption text-muted-foreground">
          These choices are applied on top of the template defaults.
        </p>
      </div>
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
    </div>
  )
}

/**
 * Advanced settings, grouped by the subject each control acts on.
 *
 * Presented as one flat column these controls read as an undifferentiated wall: the same text style
 * appears once per capability list, and layer, texture and diagnostic switches sit at the same
 * visual weight as the typography they modify. Categories give each subject a single home, and
 * collapsing them by default means entering Advanced mode shows a short menu rather than every
 * control the template can expose.
 */
export function EditorAdvancedPanel({
  alphaExportBusy,
  alphaExportReady,
  controller,
  exactBoundsBusy,
  onDownloadAlphaChannels,
  onShowExactBoundsChange,
  onShowTextInteractionBoundsChange,
  showExactBounds,
  showTextInteractionBounds,
}: EditorAdvancedPanelProps) {
  const {
    activeDefaultLayerVisibility,
    activeLayerGroups,
    activeOverrides,
    activePresetTargets,
    compressibleText,
    debugLoggingEnabled,
    defaultPresentation,
    fittedText,
    layers,
    paintableText,
    presentation,
    presentationOverrides,
    presetOverrides,
    setAllLayers,
    setDebugLoggingEnabled,
    setLayer,
    setPresetOverride,
    setTextFitProfile,
    setTextTypography,
  } = controller

  const textStyles = useMemo(
    () => groupEditorTextStyles(fittedText, compressibleText, paintableText),
    [compressibleText, fittedText, paintableText],
  )
  // Overrides are keyed by the resolved style, which is exactly a group's key, so a style row can
  // report that it carries one.
  const changedTextStyles = useMemo(
    () =>
      new Set(
        activeOverrides.flatMap((override) =>
          override.kind === "text-fit" || override.kind === "text-typography"
            ? [`${override.layerId}:${override.styleId}`]
            : [],
        ),
      ),
    [activeOverrides],
  )
  // Artwork overrides are deliberately uncounted here: their controls live with the artwork itself
  // in Card details, so attributing them to a category in this panel would point nowhere.
  const changed = useMemo(() => {
    const counts = { appearance: 0, layers: 0, text: 0 }
    for (const { kind } of activeOverrides) {
      if (kind === "preset") counts.appearance += 1
      else if (kind === "layer" || kind === "layer-mask") counts.layers += 1
      else if (kind === "text-fit" || kind === "text-typography") counts.text += 1
    }
    return counts
  }, [activeOverrides])
  const layerCount = activeLayerGroups.reduce((total, { layers: group }) => total + group.length, 0)
  const diagnosticsOn = debugLoggingEnabled || showExactBounds || showTextInteractionBounds

  return (
    <Accordion className="w-full" type="multiple">
      {textStyles.length > 0 && (
        <AdvancedCategory
          index={0}
          summary={categorySummary(changed.text, plural(textStyles.length, "style"))}
          title="Text styles"
          value="text"
        >
          {/* A style is the unit these controls belong to, so each one owns a row of its own: the
            outer category answers "which style?" before any control has to be read. */}
          <Accordion className="w-full" type="multiple">
            {textStyles.map(
              ({ compression, fit, key, layerId, paint, style, styleId, styleLabel }, index) => (
                <AdvancedCategory
                  index={index}
                  key={key}
                  summary={changedTextStyles.has(key) ? "changed" : undefined}
                  title={styleLabel}
                  value={key}
                >
                  {fit && (
                    <TextSizeControl
                      label="Size"
                      layerId={layerId}
                      presentation={presentation}
                      setTextFitProfile={setTextFitProfile}
                    />
                  )}
                  {compression && (
                    <TextCompressionControl
                      defaultTypography={
                        defaultPresentation.text[layerId]?.typography ?? style.typography
                      }
                      label="Compression"
                      layerId={layerId}
                      setTextTypography={setTextTypography}
                      styleId={styleId}
                      styleLabel={styleLabel}
                      typography={style.typography}
                      usesOverride={
                        presentationOverrides.textTypography?.[layerId]?.[styleId]
                          ?.maxAutoCompressionX !== undefined
                      }
                    />
                  )}
                  {paint && (
                    <TextPaintControl
                      defaultTypography={
                        defaultPresentation.text[layerId]?.typography ?? style.typography
                      }
                      layerId={layerId}
                      setTextTypography={setTextTypography}
                      styleId={styleId}
                      styleLabel={styleLabel}
                      typography={style.typography}
                      usesOverride={
                        presentationOverrides.textTypography?.[layerId]?.[styleId]?.fill !==
                          undefined ||
                        presentationOverrides.textTypography?.[layerId]?.[styleId]?.stroke !==
                          undefined
                      }
                    />
                  )}
                </AdvancedCategory>
              ),
            )}
          </Accordion>
        </AdvancedCategory>
      )}

      {activePresetTargets.length > 0 && (
        <AdvancedCategory
          index={1}
          summary={categorySummary(
            changed.appearance,
            plural(activePresetTargets.length, "surface"),
          )}
          title="Appearance"
          value="appearance"
        >
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
        </AdvancedCategory>
      )}

      <AdvancedCategory
        index={2}
        summary={categorySummary(changed.layers, plural(layerCount, "layer"))}
        title="Layers"
        value="layers"
      >
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
      </AdvancedCategory>

      <AdvancedCategory
        index={3}
        summary={diagnosticsOn ? "On" : undefined}
        title="Diagnostics"
        value="diagnostics"
      >
        <p className="text-caption text-muted-foreground">
          Inspection aids for the rendered card. They never change the exported image.
        </p>
        <div className="grid gap-3">
          <Switch
            checked={debugLoggingEnabled}
            label="Render logging"
            onToggle={() => setDebugLoggingEnabled(!debugLoggingEnabled)}
          />
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
        </div>
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
      </AdvancedCategory>
    </Accordion>
  )
}
