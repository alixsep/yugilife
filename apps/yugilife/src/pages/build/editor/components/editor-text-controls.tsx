import { RotateCcw } from "lucide-react"
import { hasLeadingAuthoredLineFitSplit } from "yugilife-core"

import { Button } from "@/components/ui/button"
import { ColorPickerPopover } from "@/components/ui/color-picker"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { useShape } from "@/lib/shape-context"
import { cn } from "@/lib/utils"

import type { useBuildController } from "../../page/use-build-controller"
import type { EditorTypographyPatch } from "../model/editor-store"
import type { CardFieldValue, TextTypography } from "yugilife-core"

type Presentation = ReturnType<typeof useBuildController>["presentation"]

interface TextSizeControlProps {
  label: string
  layerId: string
  presentation: Presentation
  setTextFitProfile: (layerId: string, styleId: string, profileId?: string) => void
}

export function TextSizeControl({
  label,
  layerId,
  presentation,
  setTextFitProfile,
}: TextSizeControlProps) {
  const resolved = presentation.text[layerId]
  const profiles = resolved?.typography.fitProfiles
  if (!resolved || !profiles || profiles.length === 0) return null
  const selectedIndex = Math.max(
    0,
    profiles.findIndex(({ id }) => id === resolved.fitProfileId) + 1,
  )
  const labels = ["Automatic", ...profiles.map(({ label: profileLabel }) => profileLabel)]

  return (
    <Slider
      formatValue={(value) => labels[value] ?? "Automatic"}
      label={label}
      max={profiles.length}
      min={0}
      step={1}
      value={selectedIndex}
      variant="scrubber"
      onChange={(value: number) =>
        setTextFitProfile(resolved.layerId, resolved.styleId, profiles[value - 1]?.id)
      }
    />
  )
}

interface TextCompressionControlProps {
  defaultTypography: TextTypography
  /** Control name inside a text-style group, where the group heading already names the style. */
  label: string
  layerId: string
  setTextTypography: (layerId: string, styleId: string, patch: EditorTypographyPatch) => void
  styleId: string
  styleLabel: string
  typography: TextTypography
  usesOverride: boolean
}

function compressionPercent(typography: TextTypography) {
  return Math.round(
    Math.max(
      typography.maxAutoCompressionX ?? 0,
      ...(typography.fitProfiles?.map(({ maxAutoCompressionX }) => maxAutoCompressionX ?? 0) ?? []),
    ) * 100,
  )
}

export function TextCompressionControl({
  defaultTypography,
  label,
  layerId,
  setTextTypography,
  styleId,
  styleLabel,
  typography,
  usesOverride,
}: TextCompressionControlProps) {
  const percent = compressionPercent(typography)
  const defaultPercent = compressionPercent(defaultTypography)

  return (
    <div className="grid gap-1">
      <Slider
        formatValue={(value) => `${value}%`}
        label={label}
        max={95}
        min={0}
        value={percent}
        variant="scrubber"
        onChange={(value: number) =>
          setTextTypography(layerId, styleId, { maxAutoCompressionX: value / 100 })
        }
      />
      {/* A reset that is dead most of the time is noise, so it appears only once there is an
        override to undo — which also makes its presence the signal that this style was touched. */}
      {usesOverride && (
        <ConfirmDialog
          confirmLabel="Reset compression"
          description={`This returns ${styleLabel} compression to the template default of ${defaultPercent}%.`}
          title="Reset text compression?"
          onConfirm={() => setTextTypography(layerId, styleId, { maxAutoCompressionX: undefined })}
          trigger={
            <Button
              className="justify-self-start"
              leadingIcon={RotateCcw}
              size="compact"
              variant="ghost"
              type="button"
            >
              Reset to {defaultPercent}%
            </Button>
          }
        />
      )}
    </div>
  )
}

interface LeadingAuthoredLineFitToggleProps {
  defaultPresentation: Presentation
  layerId: string
  presentation: Presentation
  setTextTypography: (layerId: string, styleId: string, patch: EditorTypographyPatch) => void
  value: CardFieldValue
}

function authoredTextSource(value: CardFieldValue) {
  if (typeof value === "string") return value
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value.join("\n")
  }
  return ""
}

export function LeadingAuthoredLineFitToggle({
  defaultPresentation,
  layerId,
  presentation,
  setTextTypography,
  value,
}: LeadingAuthoredLineFitToggleProps) {
  const shape = useShape()
  const defaultText = defaultPresentation.text[layerId]
  const text = presentation.text[layerId]
  if (
    !defaultText?.typography.fitBlocks ||
    !hasLeadingAuthoredLineFitSplit(authoredTextSource(value))
  ) {
    return null
  }

  const enabled = text?.typography.fitBlocks !== undefined
  return (
    <div className={cn("bg-muted/50 grid gap-3 p-3", shape.container)}>
      <div className="grid gap-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-body">Auto fit first line</span>
          <Switch
            checked={enabled}
            className="py-0"
            hideLabel
            label="Auto fit first line"
            onToggle={() =>
              setTextTypography(defaultText.layerId, defaultText.styleId, {
                fitBlocks: enabled ? null : undefined,
              })
            }
          />
        </div>
        <p className="text-caption text-muted-foreground">
          Tries to keep the first line to one line when possible, while fitting the rest separately.
        </p>
      </div>
    </div>
  )
}

interface TextPaintControlProps {
  defaultTypography: TextTypography
  layerId: string
  setTextTypography: (layerId: string, styleId: string, patch: EditorTypographyPatch) => void
  styleId: string
  styleLabel: string
  typography: TextTypography
  usesOverride: boolean
}

/** Width offered for a newly added outline when the template declares none to inherit. */
const addedStrokeWidth = 4
const addedStrokeColor = "#111111"
const maxStrokeWidth = 24
/** Outlines are thin enough that whole pixels are a coarse grid, so the slider moves in halves. */
const strokeWidthStep = 0.5

/** Snaps to the half-pixel grid, which also clears the float drift of a fractional slider step. */
function snapStrokeWidth(width: number) {
  return Math.round(width / strokeWidthStep) * strokeWidthStep
}

/**
 * Fill and outline for one resolved text style. Both are ordinary sparse typography patches, so this
 * control introduces no new persisted shape: it writes into the same `textTypography` override slot
 * that semantic styles and fit profiles already use.
 *
 * Overrides are keyed by the *currently resolved* style, which is what makes a full-art title and an
 * ordinary title independently stylable. The enclosing style group names that style, so the choice
 * reads as scoped rather than global.
 */
export function TextPaintControl({
  defaultTypography,
  layerId,
  setTextTypography,
  styleId,
  styleLabel,
  typography,
  usesOverride,
}: TextPaintControlProps) {
  const stroke = typography.stroke
  const removeStroke = () =>
    // `null` clears an inherited template outline; `undefined` only drops this user override. Both
    // end with no outline, but only `null` would survive a template that declares one.
    setTextTypography(layerId, styleId, {
      stroke: defaultTypography.stroke ? null : undefined,
    })

  return (
    <div className="grid gap-3">
      {/* Each control names itself, so they sit on one row as peers rather than behind a "Color"
        label that would push them into the right margin. The row wraps at narrow widths instead of
        crushing the triggers. */}
      <div className="flex flex-wrap items-center gap-1">
        <ColorPickerPopover
          triggerLabel="Text color"
          triggerShowValue={false}
          value={typography.fill}
          onValueChange={(value) => setTextTypography(layerId, styleId, { fill: value })}
        />
        {stroke ? (
          <ColorPickerPopover
            triggerLabel="Outline color"
            triggerShowRemove
            triggerShowValue={false}
            value={stroke.color}
            onTriggerRemove={removeStroke}
            onValueChange={(value) =>
              setTextTypography(layerId, styleId, { stroke: { ...stroke, color: value } })
            }
          />
        ) : (
          <Button
            variant="ghost"
            type="button"
            onClick={() =>
              setTextTypography(layerId, styleId, {
                stroke: { color: addedStrokeColor, width: addedStrokeWidth },
              })
            }
          >
            Add outline
          </Button>
        )}
        {usesOverride && (
          <ConfirmDialog
            confirmLabel="Reset text paint"
            description={`This returns ${styleLabel} color and outline to the template default.`}
            title="Reset text color and outline?"
            onConfirm={() =>
              setTextTypography(layerId, styleId, { fill: undefined, stroke: undefined })
            }
            trigger={
              <Button leadingIcon={RotateCcw} variant="ghost" type="button">
                Reset
              </Button>
            }
          />
        )}
      </div>
      {stroke && (
        <Slider
          formatValue={(value) => `${snapStrokeWidth(value)}px`}
          label="Outline width"
          max={maxStrokeWidth}
          min={strokeWidthStep}
          step={strokeWidthStep}
          value={stroke.width}
          variant="scrubber"
          onChange={(value: number) =>
            setTextTypography(layerId, styleId, {
              stroke: { ...stroke, width: snapStrokeWidth(value) },
            })
          }
        />
      )}
    </div>
  )
}
