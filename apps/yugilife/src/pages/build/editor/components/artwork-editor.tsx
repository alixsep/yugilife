import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react"

import { Download, Eraser, Minus, MousePointer2, Plus, RotateCcw, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { NumberInput } from "@/components/ui/number-input"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Toggle } from "@/components/ui/toggle"
import { Tooltip } from "@/components/ui/tooltip"
import {
  isQuickSelectionWorkerAbortError,
  QuickSelectionWorkerClient,
} from "@/lib/pin-mask/quick-selection-worker-client"
import { resampleAlpha } from "@/lib/pin-mask/resample-alpha"
import {
  ARTWORK_ATTACHMENT_OVERLAP_PX,
  buildConcaveAttachmentPath,
  getShapeContainerRadius,
} from "@/lib/rounded-surface-geometry"
import { useShape } from "@/lib/shape-context"
import { powerSliderScale } from "@/lib/slider-scale"
import { cn } from "@/lib/utils"

import { selectedArtworkMask } from "../model/artwork-mask-state"
import { toggleArtworkFullArt } from "../model/editor-config"

import {
  createWorkspaceMaskPixels,
  createWorkspaceMaskSurfaces,
  drawWorkspaceStripes,
  loadWorkspaceSource,
  workspaceDimensions,
} from "./artwork-mask-canvas"
import { MaskImageInput } from "./mask-image-input"

import type { ArtworkMaskEditingState, ArtworkMaskEffects } from "../model/editor-document"
import type { ArtworkWorkspaceSource } from "./artwork-mask-canvas"
import type {
  ArtworkMaskChannel,
  ProcessedArtworkMaskPixels,
} from "@/lib/pin-mask/artwork-mask-effects"
import type { PinMaskPoint } from "@/lib/pin-mask/quick-selection"
import type { ArtworkTransform } from "yugilife-core"

export type ArtworkEditorTool = PinMaskPoint["polarity"] | "select"

const PIN_SIZE_MIN = 4
const PIN_SIZE_MAX = 128
const ARTWORK_ZOOM_MAX = 2.5
// Keep fine control over small seeds without changing the stored semantic size values.
const PIN_SIZE_SCALE = powerSliderScale(32, 0.5)

interface ArtworkEditorProps {
  artwork: Blob
  canResetTransform: boolean
  mask: ArtworkMaskEditingState
  maskEffects: ArtworkMaskEffects | undefined
  onMaskChange: (mask: ArtworkMaskEditingState) => void
  onMaskEffectsChange: ((effects: ArtworkMaskEffects) => void) | undefined
  onSelectedPinChange: (id: number | null) => void
  onPinSizeChange: (size: number) => void
  onResetTransform: () => void
  onToolChange: (tool: ArtworkEditorTool) => void
  onTransformChange: (transform: ArtworkTransform) => void
  pinSize: number
  selectedPinId: number | null
  tool: ArtworkEditorTool
  transform: ArtworkTransform
}

interface ArtworkFullArtToggleProps {
  onTransformChange: (transform: ArtworkTransform) => void
  transform: ArtworkTransform
}

/**
 * A template-capability control that is physically attached to the artwork input. Keeping this
 * separate from the crop/mask editor prevents the full-art presentation choice from looking like
 * another adjustment group while preserving one shared transform model.
 */
export function ArtworkFullArtToggle({ onTransformChange, transform }: ArtworkFullArtToggleProps) {
  const shape = useShape()
  const clipId = useId().replace(/:/g, "")
  const attachmentRef = useRef<HTMLDivElement>(null)
  const [attachmentSize, setAttachmentSize] = useState({ height: 0, width: 0 })
  const enabled = transform.mode === "full-art"
  const cornerRadius = getShapeContainerRadius(shape.container)

  useLayoutEffect(() => {
    const element = attachmentRef.current
    if (!element) return

    const measure = () => {
      const { height, width } = element.getBoundingClientRect()
      setAttachmentSize((previous) =>
        previous.height === height && previous.width === width ? previous : { height, width },
      )
    }

    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const attachmentPath =
    attachmentSize.width > 0 && attachmentSize.height > 0
      ? buildConcaveAttachmentPath({
          height: attachmentSize.height,
          overlap: ARTWORK_ATTACHMENT_OVERLAP_PX,
          radius: cornerRadius,
          width: attachmentSize.width,
        })
      : null

  return (
    <div
      ref={attachmentRef}
      className={cn(
        "text-foreground relative isolate z-30 flex items-center justify-between gap-3 overflow-hidden px-3 pt-5 pb-3",
        shape.container,
        "-mb-2 -translate-y-2 rounded-t-none",
      )}
    >
      {attachmentPath && (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full"
          preserveAspectRatio="none"
          viewBox={`0 0 ${attachmentSize.width} ${attachmentSize.height}`}
        >
          <defs>
            <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
              <path d={attachmentPath} />
            </clipPath>
          </defs>
          <rect
            clipPath={`url(#${clipId})`}
            fill="var(--active)"
            height={attachmentSize.height}
            width={attachmentSize.width}
            x="0"
            y="0"
          />
        </svg>
      )}
      <span className="text-body relative z-10 font-medium">Enable full art</span>
      <Switch
        checked={enabled}
        className="relative z-10 shrink-0 py-0"
        hideLabel
        label="Enable full art"
        onToggle={() => onTransformChange(toggleArtworkFullArt(transform))}
        size="default"
      />
    </div>
  )
}

function TransformSlider({
  formatValue,
  label,
  max,
  min,
  onChange,
  onChangeEnd,
  onKeyDownCapture,
  step = 0.01,
  value,
}: {
  formatValue: (value: number) => string
  label: string
  max: number
  min: number
  onChange: (value: number) => void
  onChangeEnd?: () => void
  onKeyDownCapture?: React.KeyboardEventHandler<HTMLDivElement>
  step?: number
  value: number
}) {
  return (
    <Slider
      formatValue={formatValue}
      label={label}
      max={max}
      min={min}
      step={step}
      value={value}
      variant="scrubber"
      onChange={onChange}
      onBlurCapture={onChangeEnd}
      onKeyDownCapture={onKeyDownCapture}
      onKeyUpCapture={onChangeEnd}
      onPointerCancelCapture={onChangeEnd}
      onPointerUpCapture={onChangeEnd}
    />
  )
}

function useRafCoalescedArtworkTransform(onChange: (transform: ArtworkTransform) => void) {
  const onChangeRef = useRef(onChange)
  const pendingRef = useRef<ArtworkTransform | undefined>(undefined)
  const frameRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const flush = useCallback(() => {
    if (frameRef.current !== undefined) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = undefined
    }
    const pending = pendingRef.current
    pendingRef.current = undefined
    if (pending) onChangeRef.current(pending)
  }, [])

  const schedule = useCallback((transform: ArtworkTransform) => {
    pendingRef.current = transform
    if (frameRef.current !== undefined) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = undefined
      const pending = pendingRef.current
      pendingRef.current = undefined
      if (pending) onChangeRef.current(pending)
    })
  }, [])

  const update = useCallback(
    (
      current: ArtworkTransform,
      updateTransform: (transform: ArtworkTransform) => ArtworkTransform,
    ) => {
      schedule(updateTransform(pendingRef.current ?? current))
    },
    [schedule],
  )

  useEffect(() => () => flush(), [flush])

  return { flush, schedule, update }
}

/**
 * The increment the position sliders move in, as a fraction of the artwork's travel.
 *
 * `formatPosition` prints the value as a percentage, so this is the 0.2% the label steps by. The
 * arrow-key nudge shares it, and the Shift nudge is a whole multiple of it, so the keyboard lands
 * on the same values a drag does instead of on a grid of its own.
 */
const POSITION_STEP = 0.002
const POSITION_COARSE_STEP = 0.01

function formatPosition(value: number) {
  const percent = Number((value * 100).toFixed(3))
  return `${percent > 0 ? "+" : ""}${percent}%`
}

function positionNudge(event: React.KeyboardEvent<HTMLDivElement>, axis: "x" | "y") {
  if (event.ctrlKey || event.metaKey) return undefined
  const arrowKey = event.key.startsWith("Arrow")
  const direction =
    axis === "x"
      ? event.key === "ArrowLeft"
        ? -1
        : event.key === "ArrowRight"
          ? 1
          : undefined
      : event.key === "ArrowUp"
        ? -1
        : event.key === "ArrowDown"
          ? 1
          : undefined
  if (direction === undefined) {
    if (arrowKey) {
      event.preventDefault()
      event.stopPropagation()
    }
    return undefined
  }
  event.preventDefault()
  event.stopPropagation()
  const magnitude = event.shiftKey ? POSITION_COARSE_STEP : POSITION_STEP
  return direction * magnitude
}

export function ArtworkEditor({
  artwork,
  canResetTransform,
  mask,
  maskEffects,
  onMaskChange,
  onMaskEffectsChange,
  onSelectedPinChange,
  onPinSizeChange,
  onResetTransform,
  onToolChange,
  onTransformChange,
  pinSize,
  selectedPinId,
  tool,
  transform,
}: ArtworkEditorProps) {
  const transformWriter = useRafCoalescedArtworkTransform(onTransformChange)
  const [removedImageMask, setRemovedImageMask] = useState<{
    artwork: Blob
    mask: Blob
    replacement: Blob | undefined
  }>()
  const [clearedPins, setClearedPins] = useState<{
    artwork: Blob
    points: ArtworkMaskEditingState["points"]
  }>()
  const [initialDots, setInitialDots] = useState({ artwork, points: mask.points })
  if (initialDots.artwork !== artwork) {
    setInitialDots({ artwork, points: mask.points })
  }
  const selectedPin = mask.points.find(({ id }) => id === selectedPinId)
  const dotsChanged = mask.points !== initialDots.points
  const displayedPinSize = Math.max(
    PIN_SIZE_MIN,
    Math.min(PIN_SIZE_MAX, selectedPin && tool === "select" ? selectedPin.size : pinSize),
  )

  const changePinSize = (size: number) => {
    if (tool === "select" && selectedPin) {
      onMaskChange({
        ...mask,
        points: mask.points.map((point) =>
          point.id === selectedPin.id ? { ...point, size } : point,
        ),
      })
      return
    }
    onPinSizeChange(size)
  }

  const nudgePosition = (axis: "x" | "y", event: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = positionNudge(event, axis)
    if (delta === undefined) return
    transformWriter.update(transform, (current) => ({
      ...current,
      [axis]: Math.max(-1, Math.min(1, Number((current[axis] + delta).toFixed(5)))),
    }))
  }

  const removeSelectedPin = () => {
    if (!selectedPin) return
    onMaskChange({
      ...mask,
      points: mask.points.filter(({ id }) => id !== selectedPin.id),
    })
    onSelectedPinChange(null)
  }

  const downloadDotMask = () => {
    if (!mask.manualMask) return
    const url = URL.createObjectURL(mask.manualMask)
    const link = document.createElement("a")
    link.href = url
    link.download = "yugilife-dot-mask.png"
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-subtitle font-medium">Artwork adjustments</h3>
          <Button
            disabled={!canResetTransform}
            leadingIcon={RotateCcw}
            size="default"
            type="button"
            variant="text"
            onClick={onResetTransform}
          >
            Reset crop
          </Button>
        </div>
        <TransformSlider
          formatValue={(value) => `${value.toFixed(2)}×`}
          label="Zoom"
          max={ARTWORK_ZOOM_MAX}
          min={1}
          value={transform.scale}
          onChange={(scale) => transformWriter.schedule({ ...transform, scale })}
          onChangeEnd={transformWriter.flush}
        />
        <TransformSlider
          formatValue={formatPosition}
          label="Horizontal position"
          max={1}
          min={-1}
          step={POSITION_STEP}
          value={transform.x}
          onChange={(x) => transformWriter.schedule({ ...transform, x })}
          onChangeEnd={transformWriter.flush}
          onKeyDownCapture={(event) => nudgePosition("x", event)}
        />
        <TransformSlider
          formatValue={formatPosition}
          label="Vertical position"
          max={1}
          min={-1}
          step={POSITION_STEP}
          value={transform.y}
          onChange={(y) => transformWriter.schedule({ ...transform, y })}
          onChangeEnd={transformWriter.flush}
          onKeyDownCapture={(event) => nudgePosition("y", event)}
        />
      </div>

      <div className="grid gap-3">
        <div className="grid gap-0.5">
          <h3 className="text-subtitle font-medium">Artwork mask</h3>
          <p className="text-caption text-muted-foreground">
            Image masks and dot masks are independent. Uploading an image mask does not change your
            pins.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            active={mask.mode === "automatic"}
            aria-pressed={mask.mode === "automatic"}
            type="button"
            variant="tertiary"
            onClick={() => {
              onMaskChange({ ...mask, mode: "automatic" })
              onSelectedPinChange(null)
            }}
          >
            Image mask
          </Button>
          <Button
            active={mask.mode === "manual"}
            aria-pressed={mask.mode === "manual"}
            type="button"
            variant="tertiary"
            onClick={() => {
              onMaskChange({
                ...mask,
                mode: "manual",
              })
              if (mask.mode !== "manual") {
                onToolChange("select")
                onSelectedPinChange(null)
              }
            }}
          >
            Dot mask
          </Button>
        </div>
        {mask.mode === "automatic" ? (
          <Field>
            <FieldLabel>Image mask</FieldLabel>
            <MaskImageInput
              artwork={artwork}
              value={mask.automaticMask}
              onChange={(automaticMask) => {
                if (mask.automaticMask && automaticMask !== mask.automaticMask)
                  setRemovedImageMask({
                    artwork,
                    mask: mask.automaticMask,
                    replacement: automaticMask,
                  })
                else setRemovedImageMask(undefined)
                onMaskChange({ ...mask, automaticMask })
              }}
            />
          </Field>
        ) : (
          <div className="grid gap-3">
            <h3 className="text-subtitle font-medium">Dot masking controls</h3>
            <div className="grid grid-cols-3 gap-2">
              <Button
                active={tool === "keep"}
                aria-pressed={tool === "keep"}
                leadingIcon={Plus}
                type="button"
                variant="tertiary"
                onClick={() => onToolChange("keep")}
              >
                Keep area
              </Button>
              <Button
                active={tool === "remove"}
                aria-pressed={tool === "remove"}
                leadingIcon={Minus}
                type="button"
                variant="tertiary"
                onClick={() => onToolChange("remove")}
              >
                Exclude area
              </Button>
              <Button
                active={tool === "select"}
                aria-pressed={tool === "select"}
                leadingIcon={MousePointer2}
                type="button"
                variant="tertiary"
                onClick={() => onToolChange("select")}
              >
                Select pin
              </Button>
            </div>
            <Slider
              formatValue={(value) => `${Math.round(value)}px`}
              label={selectedPin && tool === "select" ? "Selected pin size" : "New pin size"}
              max={PIN_SIZE_MAX}
              min={PIN_SIZE_MIN}
              scale={PIN_SIZE_SCALE}
              step={1}
              value={displayedPinSize}
              variant="scrubber"
              onChange={(value: number) => changePinSize(value)}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Tooltip
                content={
                  mask.manualMask
                    ? "Download the current dot mask"
                    : "Finish updating the dot mask before downloading it"
                }
              >
                <Button
                  className="w-full"
                  disabled={!mask.manualMask}
                  leadingIcon={Download}
                  type="button"
                  variant="tertiary"
                  onClick={downloadDotMask}
                >
                  Download mask
                </Button>
              </Tooltip>
              <ConfirmDialog
                confirmLabel="Reset dots"
                description="Return the dots to the set that was present when this artwork was opened. The dot mask will be recalculated."
                disabled={!dotsChanged}
                title="Reset dots?"
                onConfirm={() => {
                  onMaskChange({
                    ...mask,
                    mode: "manual",
                    points: initialDots.points,
                  })
                  onSelectedPinChange(null)
                  onToolChange("select")
                }}
                trigger={
                  <Button
                    className="w-full"
                    disabled={!dotsChanged}
                    leadingIcon={RotateCcw}
                    type="button"
                    variant="tertiary"
                  >
                    Reset dots
                  </Button>
                }
              />
              <ConfirmDialog
                confirmLabel="Clear all pins"
                description="This removes every keep and exclude pin, then recalculates the dot mask."
                disabled={mask.points.length === 0}
                title="Clear all pins?"
                onConfirm={() => {
                  setClearedPins({ artwork, points: mask.points })
                  onMaskChange({ ...mask, mode: "manual", points: [] })
                  onSelectedPinChange(null)
                }}
                trigger={
                  <Button className="w-full" leadingIcon={Eraser} type="button" variant="tertiary">
                    Clear all pins
                  </Button>
                }
              />
              <Tooltip content="Delete current pin">
                <Button
                  aria-label="Delete current pin"
                  className="w-full"
                  disabled={!selectedPin || tool !== "select"}
                  leadingIcon={Trash2}
                  type="button"
                  variant="tertiary"
                  onClick={removeSelectedPin}
                >
                  Delete current pin
                </Button>
              </Tooltip>
            </div>
          </div>
        )}
        {removedImageMask?.artwork === artwork &&
          mask.automaticMask === removedImageMask.replacement && (
            <Button
              variant="ghost"
              onClick={() => {
                onMaskChange({ ...mask, automaticMask: removedImageMask.mask })
                setRemovedImageMask(undefined)
              }}
            >
              {mask.automaticMask ? "Undo image mask replacement" : "Undo image mask removal"}
            </Button>
          )}
        {mask.points.length === 0 && clearedPins?.artwork === artwork && (
          <Button
            variant="ghost"
            onClick={() => {
              onMaskChange({ ...mask, points: clearedPins.points })
              setClearedPins(undefined)
            }}
          >
            Undo clear pins
          </Button>
        )}
        <p className="text-caption text-muted-foreground">
          {mask.mode === "manual"
            ? selectedPin && tool === "select"
              ? `${selectedPin.polarity === "keep" ? "Keep area" : "Exclude area"} selected. Drag it on the artwork or resize it below.`
              : "Dot mask is active and updates as pins change. Select a pin to move or resize it."
            : "The image mask is active. Dot mode begins from the database pins."}
        </p>
      </div>

      {maskEffects && onMaskEffectsChange && (
        <div className="grid grid-cols-2 gap-2">
          <Field>
            <FieldLabel>Mask anti-aliasing</FieldLabel>
            <Toggle
              className="w-full"
              pressed={maskEffects.antiAlias === true}
              onPressedChange={(pressed) =>
                onMaskEffectsChange({ ...maskEffects, antiAlias: pressed })
              }
            >
              {maskEffects.antiAlias === true ? "On" : "Off"}
            </Toggle>
          </Field>
          <Field>
            <FieldLabel>Mask glow</FieldLabel>
            <NumberInput
              max={128}
              min={0}
              step={1}
              value={maskEffects.glow ?? 0}
              onValueChange={(value) => onMaskEffectsChange({ ...maskEffects, glow: value ?? 0 })}
            />
          </Field>
        </div>
      )}
    </div>
  )
}

interface ArtworkMaskWorkspaceProps {
  artwork: Blob
  mask: ArtworkMaskEditingState
  maskChannel: ArtworkMaskChannel
  artworkEffectsError?: string | undefined
  processedMaskBusy: boolean
  getProcessedMaskPixels: () => ProcessedArtworkMaskPixels | undefined
  processedMaskRevision: number
  onMaskChange: (mask: ArtworkMaskEditingState) => void
  onMaskComplete?: (artwork: Blob, points: ArtworkMaskEditingState["points"], mask: Blob) => void
  onRetryArtworkEffects?: () => void
  onSelectedPinChange: (id: number | null) => void
  pinSize: number
  selectedPinId: number | null
  tool: ArtworkEditorTool
}

function artworkCanvasPoint(
  clientX: number,
  clientY: number,
  target: HTMLCanvasElement,
  coordinateWidth: number,
  coordinateHeight: number,
): { x: number; y: number; scale: number } | undefined {
  const bounds = target.getBoundingClientRect()
  if (bounds.width === 0 || bounds.height === 0) return undefined
  const scale = Math.min(bounds.width / coordinateWidth, bounds.height / coordinateHeight)
  return {
    scale,
    x: Math.max(
      0,
      Math.min(coordinateWidth - 1, ((clientX - bounds.left) / bounds.width) * coordinateWidth),
    ),
    y: Math.max(
      0,
      Math.min(coordinateHeight - 1, ((clientY - bounds.top) / bounds.height) * coordinateHeight),
    ),
  }
}

function nearestArtworkPin(
  points: readonly PinMaskPoint[],
  point: { x: number; y: number },
  scale: number,
) {
  let nearest: PinMaskPoint | undefined
  let distance = Number.POSITIVE_INFINITY
  for (const candidate of points) {
    const current = Math.hypot(candidate.x - point.x, candidate.y - point.y)
    if (current < distance) {
      distance = current
      nearest = candidate
    }
  }
  if (!nearest) return undefined
  const threshold = Math.max(16 / scale, nearest.size / 2 + 7 / scale)
  return distance <= threshold ? nearest : undefined
}

export function ArtworkMaskWorkspace({
  artwork,
  mask,
  maskChannel,
  artworkEffectsError,
  processedMaskBusy,
  getProcessedMaskPixels,
  processedMaskRevision,
  onMaskChange,
  onMaskComplete,
  onRetryArtworkEffects,
  onSelectedPinChange,
  pinSize,
  selectedPinId,
  tool,
}: ArtworkMaskWorkspaceProps) {
  const shape = useShape()
  const canvas = useRef<HTMLCanvasElement>(null)
  const maskRef = useRef(mask)
  // The saved manual mask already represents these pins. Restore it without preparing and
  // refining the artwork again; the first actual pin edit invalidates this snapshot.
  const restoredPinsRef = useRef(
    mask.manualMask && mask.manualMask !== mask.automaticMask ? mask.points : undefined,
  )
  const pointsRef = useRef(mask.points)
  const selectedPinRef = useRef(selectedPinId)
  const drawFrameRef = useRef<((phase: number) => void) | undefined>(undefined)
  const activeRenderTokenRef = useRef<symbol | undefined>(undefined)
  const stripePhaseRef = useRef(0)
  const stripeTimestampRef = useRef<number | undefined>(undefined)
  const isDraggingRef = useRef(false)
  const dragRef = useRef<
    | {
        moved: boolean
        pinId: number
        pointerId: number
        startX: number
        startY: number
        x: number
        y: number
      }
    | undefined
  >(undefined)
  const preparingRef = useRef(false)
  const preparedSourceRef = useRef<ArtworkWorkspaceSource | undefined>(undefined)
  const sourceRef = useRef<ArtworkWorkspaceSource | undefined>(undefined)
  const sourceRequestRef = useRef(0)
  const workerRef = useRef<QuickSelectionWorkerClient | undefined>(undefined)
  const workerOperationRef = useRef(0)
  // Native-size pixel planes stay in refs so React never has to retain or inspect them as state.
  // Revisions below are the small invalidation signals that drive the render effects.
  const sourcePixelsRef = useRef<ImageData | undefined>(undefined)
  const selectionRef = useRef<Uint8Array | undefined>(undefined)
  const [source, setSource] = useState<ArtworkWorkspaceSource>()
  const [preparedRevision, setPreparedRevision] = useState(0)
  const [selectionRetry, setSelectionRetry] = useState(0)
  const [selectionRevision, setSelectionRevision] = useState(0)
  const [preparing, setPreparing] = useState(false)
  const [workerBusy, setWorkerBusy] = useState(false)
  const [status, setStatus] = useState<string>()
  const [paintedMaskRevisions, setPaintedMaskRevisions] = useState({ selection: 0, effects: 0 })
  const workspaceBusy =
    workerBusy ||
    processedMaskBusy ||
    (!status &&
      (paintedMaskRevisions.selection !== selectionRevision ||
        paintedMaskRevisions.effects !== processedMaskRevision))

  useEffect(() => {
    maskRef.current = mask
    pointsRef.current = mask.points
    selectedPinRef.current = selectedPinId
  }, [mask, selectedPinId])

  useEffect(() => {
    if (tool !== "select" && selectedPinId !== null) onSelectedPinChange(null)
  }, [onSelectedPinChange, selectedPinId, tool])

  useEffect(() => {
    if (selectedPinId !== null && !mask.points.some(({ id }) => id === selectedPinId)) {
      onSelectedPinChange(null)
    }
  }, [mask.points, onSelectedPinChange, selectedPinId])

  useEffect(
    () => () => {
      isDraggingRef.current = false
      dragRef.current = undefined
      activeRenderTokenRef.current = undefined
      drawFrameRef.current = undefined
    },
    [],
  )

  useEffect(() => {
    const requestId = sourceRequestRef.current + 1
    sourceRequestRef.current = requestId
    onSelectedPinChange(null)
    sourceRef.current = undefined
    preparedSourceRef.current = undefined
    activeRenderTokenRef.current = undefined
    drawFrameRef.current = undefined
    workerOperationRef.current += 1
    preparingRef.current = false
    let cancelled = false
    const reset = window.setTimeout(() => {
      if (cancelled || requestId !== sourceRequestRef.current || sourceRef.current) return
      setSource(undefined)
      sourcePixelsRef.current = undefined
      selectionRef.current = undefined
      setSelectionRevision((revision) => revision + 1)
      setPreparing(false)
      setWorkerBusy(false)
      setStatus(undefined)
    }, 0)
    const activeMask = selectedArtworkMask(maskRef.current)
    restoredPinsRef.current =
      maskRef.current.manualMask && maskRef.current.manualMask !== maskRef.current.automaticMask
        ? maskRef.current.points
        : undefined
    void loadWorkspaceSource(artwork, activeMask)
      .then((next) => {
        if (cancelled || requestId !== sourceRequestRef.current) {
          next.artwork.close()
          next.mask?.close()
          return
        }
        sourcePixelsRef.current = undefined
        selectionRef.current = undefined
        setSelectionRevision((revision) => revision + 1)
        setPreparing(false)
        setWorkerBusy(false)
        setStatus(undefined)
        sourceRef.current = next
        setSource(next)
      })
      .catch((reason: unknown) => {
        if (!cancelled && requestId === sourceRequestRef.current) {
          setWorkerBusy(false)
          setStatus(reason instanceof Error ? reason.message : String(reason))
        }
      })
    return () => {
      cancelled = true
      if (sourceRequestRef.current === requestId) sourceRequestRef.current += 1
      window.clearTimeout(reset)
      workerRef.current?.dispose()
      workerRef.current = undefined
      preparedSourceRef.current = undefined
    }
  }, [artwork, mask.automaticMask, mask.mode, onSelectedPinChange])

  useEffect(
    () => () => {
      source?.artwork.close()
      source?.mask?.close()
    },
    [source],
  )

  useEffect(() => {
    if (!source || preparedSourceRef.current !== source || mask.mode !== "manual") {
      return
    }
    let cancelled = false
    const worker = workerRef.current
    if (!worker) return
    const operationId = ++workerOperationRef.current
    setWorkerBusy(true)
    setStatus(undefined)
    void worker
      .refineEncoded(mask.points)
      .then(({ mask: next, blob: manualMask }) => {
        if (cancelled || preparedSourceRef.current !== source) return
        selectionRef.current = next
        setSelectionRevision((revision) => revision + 1)
        setStatus(undefined)
        if (onMaskComplete) onMaskComplete(artwork, mask.points, manualMask)
        else if (maskRef.current.points === mask.points)
          onMaskChange({ ...maskRef.current, manualMask })
      })
      .catch((reason: unknown) => {
        if (!cancelled && !isQuickSelectionWorkerAbortError(reason)) {
          setStatus(reason instanceof Error ? reason.message : String(reason))
        }
      })
      .finally(() => {
        if (workerOperationRef.current === operationId) setWorkerBusy(false)
      })
    return () => {
      cancelled = true
      if (workerOperationRef.current === operationId) workerOperationRef.current += 1
    }
  }, [artwork, mask.mode, mask.points, onMaskChange, onMaskComplete, preparedRevision, source])

  useEffect(() => {
    const target = canvas.current
    // A newly refined raw mask is document data, not a completed presentation. Preserve the
    // previous canvas until its requested effects frame is ready; never paint intermediate alpha.
    if (!target || !source || processedMaskBusy) return
    // Assigning canvas dimensions clears its bitmap. Keep the last completed frame visible while
    // a new mask-effects job is prepared; only resize when the source itself changed.
    const displaySize = workspaceDimensions(source.artwork.width, source.artwork.height)
    if (target.width !== displaySize.width) target.width = displaySize.width
    if (target.height !== displaySize.height) target.height = displaySize.height
    const context = target.getContext("2d")
    if (!context) return

    // Build the expensive shaded/masked artwork once. Animation frames only copy this cached
    // surface and paint the lightweight stripe and pin overlays, which keeps large AVIFs responsive
    // while a user places dots. Anti-aliasing and glow have already been derived by the app-owned
    // pin-mask worker and arrive here as a display mask pixel plane. During replacement work the
    // last canvas bitmap remains visible, but its old animation closure is released.
    let cancelled = false
    const renderToken = Symbol("artwork-mask-render")

    const prepare = () => {
      const sourceWidth = source.artwork.width
      const sourceHeight = source.artwork.height
      const { height, width } = workspaceDimensions(sourceWidth, sourceHeight)
      const selection = selectionRef.current
      const sourcePixels = sourcePixelsRef.current
      const refinedSourcePixels =
        mask.mode === "manual" && selection && sourcePixels && preparedSourceRef.current === source
          ? sourcePixels
          : undefined
      const refinedSelection =
        refinedSourcePixels && selection
          ? resampleAlpha(selection, sourceWidth, sourceHeight, width, height)
          : undefined
      const sourceMaskPixels = createWorkspaceMaskPixels(
        source,
        width,
        height,
        maskChannel,
        refinedSelection,
        getProcessedMaskPixels(),
      )
      const renderMaskPixels = sourceMaskPixels
      if (cancelled) return

      const base = document.createElement("canvas")
      base.width = width
      base.height = height
      const baseContext = base.getContext("2d")
      if (!baseContext) return
      const surfaces = renderMaskPixels
        ? createWorkspaceMaskSurfaces(renderMaskPixels, width, height)
        : undefined
      if (refinedSourcePixels && refinedSelection && renderMaskPixels) {
        const shaded = baseContext.createImageData(width, height)
        for (let index = 0; index < refinedSelection.length; index += 1) {
          const offset = index * 4
          const processedAlpha = renderMaskPixels[offset + 3] ?? refinedSelection[index]!
          const brightness = 0.3 + (processedAlpha / 255) * 0.7
          shaded.data[offset] = Math.round(refinedSourcePixels.data[offset]! * brightness)
          shaded.data[offset + 1] = Math.round(refinedSourcePixels.data[offset + 1]! * brightness)
          shaded.data[offset + 2] = Math.round(refinedSourcePixels.data[offset + 2]! * brightness)
          shaded.data[offset + 3] = refinedSourcePixels.data[offset + 3]!
        }
        baseContext.putImageData(shaded, 0, 0)
      } else {
        baseContext.drawImage(source.artwork, 0, 0, width, height)
        if (surfaces) {
          baseContext.save()
          baseContext.globalAlpha = 0.75
          baseContext.globalCompositeOperation = "multiply"
          baseContext.drawImage(surfaces.foreground, 0, 0)
          baseContext.restore()
        }
      }

      const stripeCanvas = document.createElement("canvas")
      stripeCanvas.width = width
      stripeCanvas.height = height
      const backgroundMask = surfaces?.background

      const drawFrame = (phase: number) => {
        context.clearRect(0, 0, width, height)
        context.drawImage(base, 0, 0)
        drawWorkspaceStripes(context, stripeCanvas, backgroundMask, width, height, phase)
        if (mask.mode !== "manual") return
        const activeDrag = dragRef.current
        const displayScale = Math.min(width / sourceWidth, height / sourceHeight)
        for (const point of pointsRef.current) {
          const sourceX = activeDrag?.pinId === point.id ? activeDrag.x : point.x
          const sourceY = activeDrag?.pinId === point.id ? activeDrag.y : point.y
          const x = sourceX * (width / sourceWidth)
          const y = sourceY * (height / sourceHeight)
          const radius = Math.max(3, point.size * displayScale * 0.5)
          if (point.id === selectedPinRef.current) {
            context.beginPath()
            context.arc(x, y, radius + Math.max(5, width / 180), 0, Math.PI * 2)
            context.lineWidth = Math.max(2, width / 350)
            context.strokeStyle = "#ffffff"
            context.stroke()
          }
          context.beginPath()
          context.arc(x, y, radius, 0, Math.PI * 2)
          context.fillStyle = point.polarity === "keep" ? "#63e2a055" : "#ff748055"
          context.fill()
          context.lineWidth = Math.max(2, width / 500)
          context.strokeStyle = point.polarity === "keep" ? "#63e2a0" : "#ff7480"
          context.stroke()
        }
      }

      // Publish the new frame atomically. Until this point the previous completed bitmap remains
      // visible, so changing a control cannot blank the workspace while the worker runs.
      activeRenderTokenRef.current = renderToken
      drawFrameRef.current = drawFrame
      drawFrame(stripePhaseRef.current)
      setPaintedMaskRevisions({ selection: selectionRevision, effects: processedMaskRevision })
      const reducedMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      if (reducedMotion) return
      const animate = (timestamp: number) => {
        if (activeRenderTokenRef.current !== renderToken) return
        const elapsed =
          stripeTimestampRef.current === undefined ? 0 : timestamp - stripeTimestampRef.current
        stripeTimestampRef.current = timestamp
        if (!isDraggingRef.current) {
          stripePhaseRef.current += elapsed * 0.024
          drawFrame(stripePhaseRef.current)
        }
        window.requestAnimationFrame(animate)
      }
      window.requestAnimationFrame(animate)
    }

    queueMicrotask(() => {
      if (cancelled) return
      try {
        prepare()
      } catch (reason: unknown) {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setStatus(reason instanceof Error ? reason.message : String(reason))
        }
      }
    })
    return () => {
      cancelled = true
      // Keep the last bitmap on the canvas, but release the old frame closure and stop its RAF
      // immediately. Otherwise a superseded native-size surface stays reachable while a new mask
      // is being prepared, needlessly doubling the peak during an effects update.
      if (activeRenderTokenRef.current === renderToken) {
        activeRenderTokenRef.current = undefined
        drawFrameRef.current = undefined
        stripeTimestampRef.current = undefined
      }
    }
  }, [
    getProcessedMaskPixels,
    mask.mode,
    maskChannel,
    processedMaskRevision,
    processedMaskBusy,
    selectionRevision,
    source,
  ])

  useEffect(() => {
    if (mask.mode === "manual") drawFrameRef.current?.(stripePhaseRef.current)
  }, [mask.mode, mask.points, selectedPinId])

  const prepareEngine = useCallback(() => {
    if (
      !source ||
      sourceRef.current !== source ||
      preparedSourceRef.current === source ||
      preparingRef.current
    ) {
      return
    }
    const preparedSource = source
    const requestId = sourceRequestRef.current
    preparingRef.current = true
    setPreparing(true)
    setWorkerBusy(true)
    setStatus("Preparing dot mask…")
    const displaySize = workspaceDimensions(source.artwork.width, source.artwork.height)
    const displayCanvas = document.createElement("canvas")
    displayCanvas.width = displaySize.width
    displayCanvas.height = displaySize.height
    const displayContext = displayCanvas.getContext("2d", { willReadFrequently: true })
    if (!displayContext) {
      preparingRef.current = false
      setPreparing(false)
      setWorkerBusy(false)
      setStatus("A 2D canvas context is required to edit artwork.")
      return
    }
    displayContext.drawImage(source.artwork, 0, 0, displaySize.width, displaySize.height)
    sourcePixelsRef.current = displayContext.getImageData(
      0,
      0,
      displaySize.width,
      displaySize.height,
    )
    workerRef.current?.dispose()
    workerRef.current = undefined
    let worker: QuickSelectionWorkerClient
    try {
      worker = new QuickSelectionWorkerClient()
    } catch (reason) {
      preparingRef.current = false
      setPreparing(false)
      setWorkerBusy(false)
      setStatus(reason instanceof Error ? reason.message : "A pin mask worker could not start.")
      return
    }
    workerRef.current = worker
    const operationId = ++workerOperationRef.current
    void createImageBitmap(source.artwork)
      .then((bitmap) => {
        if (requestId !== sourceRequestRef.current || sourceRef.current !== preparedSource) {
          bitmap.close()
          return
        }
        return worker.prepareBitmap(bitmap)
      })
      .then(() => {
        if (requestId !== sourceRequestRef.current || sourceRef.current !== preparedSource) return
        preparedSourceRef.current = preparedSource
        setPreparedRevision((revision) => revision + 1)
        setStatus(undefined)
      })
      .catch((reason: unknown) => {
        if (requestId !== sourceRequestRef.current || sourceRef.current !== preparedSource) return
        setStatus(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (requestId !== sourceRequestRef.current || sourceRef.current !== preparedSource) return
        preparingRef.current = false
        setPreparing(false)
        if (workerOperationRef.current === operationId) setWorkerBusy(false)
      })
  }, [source])

  useEffect(() => {
    if (
      mask.mode !== "manual" ||
      mask.points === restoredPinsRef.current ||
      !source ||
      preparedSourceRef.current === source ||
      preparingRef.current
    )
      return
    prepareEngine()
  }, [mask.mode, mask.points, prepareEngine, source, selectionRetry])

  const updatePoints = useCallback(
    (points: readonly PinMaskPoint[]) => {
      const current = maskRef.current
      const next = {
        ...current,
        mode: "manual" as const,
        points,
      }
      maskRef.current = next
      pointsRef.current = points
      onMaskChange(next)
    },
    [onMaskChange],
  )

  const resumeStripeAnimation = () => {
    isDraggingRef.current = false
    stripeTimestampRef.current = undefined
    drawFrameRef.current?.(stripePhaseRef.current)
  }

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.stopPropagation()
    if (
      !source ||
      mask.mode !== "manual" ||
      (event.pointerType === "mouse" && event.button !== 0)
    ) {
      return
    }
    const target = event.currentTarget
    const point = artworkCanvasPoint(
      event.clientX,
      event.clientY,
      target,
      source.artwork.width,
      source.artwork.height,
    )
    if (!point) return
    const currentMask = maskRef.current
    const hit = nearestArtworkPin(currentMask.points, point, point.scale)
    if (hit) {
      selectedPinRef.current = hit.id
      onSelectedPinChange(hit.id)
      isDraggingRef.current = true
      dragRef.current = {
        moved: false,
        pinId: hit.id,
        pointerId: event.pointerId,
        startX: hit.x,
        startY: hit.y,
        x: hit.x,
        y: hit.y,
      }
      try {
        target.setPointerCapture(event.pointerId)
      } catch {
        // Pointer capture is unavailable in a few embedded browser surfaces.
      }
      drawFrameRef.current?.(stripePhaseRef.current)
      return
    }
    if (tool === "select") {
      selectedPinRef.current = null
      onSelectedPinChange(null)
      drawFrameRef.current?.(stripePhaseRef.current)
      return
    }
    const nextPoint: PinMaskPoint = {
      id: Math.max(0, ...currentMask.points.map(({ id }) => id)) + 1,
      polarity: tool,
      size: pinSize,
      x: point.x,
      y: point.y,
    }
    onSelectedPinChange(null)
    updatePoints([...currentMask.points, nextPoint])
    drawFrameRef.current?.(stripePhaseRef.current)
    prepareEngine()
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!source) return
    event.stopPropagation()
    const target = event.currentTarget
    const point = artworkCanvasPoint(
      event.clientX,
      event.clientY,
      target,
      source.artwork.width,
      source.artwork.height,
    )
    if (!point) return
    drag.moved = drag.moved || point.x !== drag.startX || point.y !== drag.startY
    drag.x = point.x
    drag.y = point.y
    drawFrameRef.current?.(stripePhaseRef.current)
  }

  const finishPointer = (event: React.PointerEvent<HTMLCanvasElement>, cancelled = false) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      if (!drag) resumeStripeAnimation()
      return
    }
    event.stopPropagation()
    if (!cancelled && drag.moved) {
      const current = maskRef.current
      updatePoints(
        current.points.map((candidate) =>
          candidate.id === drag.pinId ? { ...candidate, x: drag.x, y: drag.y } : candidate,
        ),
      )
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = undefined
    resumeStripeAnimation()
  }

  const onContextMenu = (event: React.MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!source || mask.mode !== "manual") return
    const point = artworkCanvasPoint(
      event.clientX,
      event.clientY,
      event.currentTarget,
      source.artwork.width,
      source.artwork.height,
    )
    if (!point) return
    const hit = nearestArtworkPin(maskRef.current.points, point, point.scale)
    if (!hit) return
    updatePoints(maskRef.current.points.filter(({ id }) => id !== hit.id))
    onSelectedPinChange(null)
  }

  return (
    <div className="relative flex size-full min-h-0 items-center justify-center p-4">
      <div className="relative flex max-h-full max-w-full shrink-0">
        <canvas
          ref={canvas}
          aria-label={
            mask.mode === "manual" ? "Artwork dot mask workspace" : "Artwork image mask preview"
          }
          className={`block max-h-full max-w-full object-contain ${
            mask.mode === "manual"
              ? tool === "select"
                ? "pointer-events-auto cursor-default"
                : "pointer-events-auto cursor-crosshair"
              : "pointer-events-none"
          }`}
          onPointerCancel={
            mask.mode === "manual" ? (event) => finishPointer(event, true) : undefined
          }
          onPointerDown={mask.mode === "manual" ? onPointerDown : undefined}
          onPointerMove={mask.mode === "manual" ? onPointerMove : undefined}
          onPointerUp={mask.mode === "manual" ? finishPointer : undefined}
          onContextMenu={mask.mode === "manual" ? onContextMenu : undefined}
        />
        {source && (
          <span
            aria-live={workspaceBusy ? "polite" : undefined}
            className={cn(
              "text-title text-foreground bg-surface-3 absolute bottom-full left-0 mb-2 inline-flex items-center gap-1.5 px-1.5 py-1 font-bold tabular-nums",
              shape.item,
            )}
          >
            {mask.mode === "manual" ? "Dot mask workspace" : "Image mask preview"}
            {workspaceBusy && (
              <LoadingSpinner
                aria-label={
                  processedMaskBusy
                    ? "Updating mask preview"
                    : preparing
                      ? "Preparing dot mask"
                      : "Updating dot mask"
                }
                className="h-5 w-7"
                size="compact"
              />
            )}
          </span>
        )}
      </div>
      {((status && !preparing) || artworkEffectsError) && (
        <div
          role="alert"
          className="bg-background/90 text-caption text-foreground absolute right-3 bottom-3 left-3 p-2"
        >
          {artworkEffectsError && (
            <div>
              Mask effects could not update: {artworkEffectsError}
              {onRetryArtworkEffects && (
                <Button variant="ghost" onClick={onRetryArtworkEffects}>
                  Retry mask effects
                </Button>
              )}
            </div>
          )}
          {status && !preparing && (
            <div>
              {status}
              {mask.mode === "manual" && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    workerRef.current?.dispose()
                    workerRef.current = undefined
                    preparedSourceRef.current = undefined
                    restoredPinsRef.current = undefined
                    setStatus(undefined)
                    setSelectionRetry((value) => value + 1)
                  }}
                >
                  Retry dot mask
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
