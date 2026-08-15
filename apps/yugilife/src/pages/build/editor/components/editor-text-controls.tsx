import { RotateCcw } from "lucide-react"
import { hasLeadingAuthoredLineFitSplit } from "yugilife-core"

import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { useShape } from "@/lib/shape-context"
import { cn } from "@/lib/utils"

import type { useBuildController } from "../../page/use-build-controller"
import type { CardFieldValue, TextTypography, TextTypographyPatch } from "yugilife-core"

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
  layerId: string
  setTextTypography: (layerId: string, styleId: string, patch: TextTypographyPatch) => void
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
        label={styleLabel}
        max={95}
        min={0}
        value={percent}
        variant="scrubber"
        onChange={(value: number) =>
          setTextTypography(layerId, styleId, { maxAutoCompressionX: value / 100 })
        }
      />
      <ConfirmDialog
        confirmLabel="Reset compression"
        description={`This returns ${styleLabel} compression to the template default of ${defaultPercent}%.`}
        disabled={!usesOverride}
        title="Reset text compression?"
        onConfirm={() => setTextTypography(layerId, styleId, { maxAutoCompressionX: undefined })}
        trigger={
          <Button
            className="justify-self-start"
            leadingIcon={RotateCcw}
            variant="ghost"
            type="button"
          >
            Reset to {defaultPercent}%
          </Button>
        }
      />
    </div>
  )
}

interface LeadingAuthoredLineFitToggleProps {
  defaultPresentation: Presentation
  layerId: string
  presentation: Presentation
  setTextTypography: (layerId: string, styleId: string, patch: TextTypographyPatch) => void
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
