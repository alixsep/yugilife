import { useCallback, useEffect, useRef, useState } from "react"

import { AnimatePresence, motion } from "framer-motion"
import { Plus, RefreshCw, Save } from "lucide-react"

import { Card } from "@/components/card"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { PreviewPlayground } from "@/components/ui/preview-playground"
import { Elevated } from "@/lib/elevated"
import { useShape } from "@/lib/shape-context"
import { spring } from "@/lib/springs"
import { cn } from "@/lib/utils"

import { renderedTextBounds, renderedTextFieldAt } from "./card-preview-hit-test"

import type { useBuildController } from "./use-build-controller"
import type { CardRenderMetadata } from "@/components/card"
import type { MouseEvent } from "react"
import type { RenderManifest } from "yugilife-core"

interface CardPreviewProps {
  controller: ReturnType<typeof useBuildController>
  manifest?: RenderManifest | undefined
  onFocusField: (fieldName: string, controlIndex?: number) => void
  onRenderMetadata: (metadata: CardRenderMetadata | undefined) => void
  showExactBounds: boolean
  showTextInteractionBounds: boolean
}

export function CardPreview({
  controller,
  manifest,
  onFocusField,
  onRenderMetadata,
  showExactBounds,
  showTextInteractionBounds,
}: CardPreviewProps) {
  const cardElement = useRef<HTMLDivElement>(null)
  const renderMetadata = useRef<CardRenderMetadata | undefined>(undefined)
  const [textRenderRevision, setTextRenderRevision] = useState(0)
  const [textBounds, setTextBounds] = useState<ReturnType<typeof renderedTextBounds>>([])
  const shape = useShape()
  const {
    activeEditorTemplate,
    comparisonMode,
    createNewCard,
    debugLoggingEnabled,
    hasUnsavedChanges,
    layers,
    loadSelectedTemplate,
    mode,
    newCardBusy,
    presentationOverrides,
    presetOverrides,
    reference,
    referenceOpacity,
    renderCardData,
    saveCard,
    savingCard,
    templateBundle,
    templateLoadError,
    templateLoadPaused,
    templateLoadProgress,
    templateLoading,
  } = controller
  const cardHeight = activeEditorTemplate.dimensions.height
  const cardWidth = activeEditorTemplate.dimensions.width
  const sideBySide = Boolean(reference && comparisonMode === "side-by-side")
  const comparisonGap = 48
  const comparisonWidth = cardWidth * 2 + comparisonGap
  const cardShare = `${(cardWidth / comparisonWidth) * 100}%`
  const gapShare = `${(comparisonGap / comparisonWidth) * 100}%`
  const aspectRatio = `${activeEditorTemplate.dimensions.width} / ${activeEditorTemplate.dimensions.height}`
  const downloadPercent =
    templateLoadProgress?.total && templateLoadProgress.total > 0
      ? Math.min(100, Math.round((templateLoadProgress.loaded / templateLoadProgress.total) * 100))
      : undefined

  const acceptRenderMetadata = useCallback(
    (metadata: CardRenderMetadata | undefined) => {
      renderMetadata.current = metadata
      onRenderMetadata(metadata)
      if (showTextInteractionBounds) {
        if (!metadata) setTextBounds([])
        setTextRenderRevision((revision) => revision + 1)
      }
    },
    [onRenderMetadata, showTextInteractionBounds],
  )

  useEffect(() => {
    if (!showTextInteractionBounds || !renderMetadata.current) return
    let idle: number | undefined
    let fallback: ReturnType<typeof setTimeout> | undefined
    const measure = () => {
      const element = cardElement.current
      const metadata = renderMetadata.current
      if (element && metadata) {
        setTextBounds(renderedTextBounds(element, metadata.textFields(), cardWidth, cardHeight))
      }
    }
    const timer = setTimeout(() => {
      if (typeof requestIdleCallback === "function") idle = requestIdleCallback(measure)
      else fallback = setTimeout(measure, 0)
    }, 500)
    return () => {
      clearTimeout(timer)
      if (idle !== undefined) cancelIdleCallback(idle)
      if (fallback !== undefined) clearTimeout(fallback)
    }
  }, [cardHeight, cardWidth, showTextInteractionBounds, textRenderRevision])

  function focusRenderedElement(event: MouseEvent<HTMLDivElement>) {
    const element = cardElement.current
    const metadata = renderMetadata.current
    if (!element || !metadata) return false
    const target = renderedTextFieldAt(element, metadata.textFields(), event.clientX, event.clientY)
    if (!target) return false
    onFocusField(target.field, target.controlIndex)
    return true
  }

  return (
    <Elevated
      aria-label="Card preview"
      className={cn(
        "border-border size-full min-h-0 min-w-0 overflow-hidden border",
        shape.container,
      )}
      offset={1}
      shadowLevel={2}
    >
      <PreviewPlayground
        actions={
          <div className="flex items-center gap-1.5">
            <Button
              disabled={!hasUnsavedChanges || !templateBundle || newCardBusy}
              leadingIcon={Save}
              loading={savingCard}
              onClick={() => void saveCard()}
              variant="primary"
            >
              {hasUnsavedChanges ? "Save" : "Saved"}
            </Button>
            <ConfirmDialog
              confirmLabel="Create new card"
              description={
                hasUnsavedChanges
                  ? "Your unsaved edits stay out of Inventory and will be discarded. Save first if you want to keep them."
                  : "A fresh card opens in this editor. Your saved inventory snapshot is unchanged."
              }
              disabled={newCardBusy || savingCard}
              title="Create a new card?"
              onConfirm={() => void createNewCard()}
              trigger={
                <Button leadingIcon={Plus} loading={newCardBusy} variant="tertiary">
                  New card
                </Button>
              }
            />
          </div>
        }
        contentHeight={cardHeight}
        contentWidth={sideBySide ? comparisonWidth : cardWidth}
        label="Card preview. Drag to pan, scroll to zoom, or use the zoom controls."
        onContentDoubleClick={focusRenderedElement}
      >
        <div className="flex size-full items-center justify-center">
          <motion.figure
            animate={{
              height: newCardBusy ? "0%" : "100%",
              width: newCardBusy ? "0%" : sideBySide ? cardShare : "100%",
            }}
            className="min-w-0 shrink-0 overflow-hidden"
            initial={false}
            transition={spring.moderate}
          >
            <div className="shadow-surface-7 relative size-full overflow-hidden" ref={cardElement}>
              {templateBundle ? (
                <Card
                  card={renderCardData}
                  className="size-full"
                  debugLogging={mode === "advanced" && debugLoggingEnabled}
                  layers={layers}
                  presetOverrides={presetOverrides}
                  presentationOverrides={presentationOverrides}
                  templateBundle={templateBundle}
                  onRenderMetadata={acceptRenderMetadata}
                />
              ) : (
                <div className="border-border bg-card text-muted-foreground text-body grid size-full place-items-center border p-8 text-center">
                  <div className="grid w-full max-w-72 gap-3">
                    {templateLoadPaused ? (
                      <>
                        <p role="status">Template cache cleared.</p>
                        <Button
                          leadingIcon={RefreshCw}
                          onClick={() => void loadSelectedTemplate()}
                          variant="tertiary"
                        >
                          Download template
                        </Button>
                      </>
                    ) : templateLoadError ? (
                      <>
                        <p className="text-destructive" role="alert">
                          Could not download the template: {templateLoadError}
                        </p>
                        <Button
                          leadingIcon={RefreshCw}
                          onClick={() => void loadSelectedTemplate()}
                          variant="tertiary"
                        >
                          Retry download
                        </Button>
                      </>
                    ) : (
                      <>
                        <p role="status">
                          {templateLoading ? "Downloading template…" : "Preparing template…"}
                          {downloadPercent === undefined ? "" : ` ${downloadPercent}%`}
                        </p>
                        <div
                          aria-hidden="true"
                          className="bg-surface-2 h-1.5 overflow-hidden rounded-full"
                        >
                          <div
                            className={cn(
                              "bg-foreground h-full rounded-full transition-[width] duration-150",
                              downloadPercent === undefined && "w-1/3 animate-pulse",
                            )}
                            style={
                              downloadPercent === undefined
                                ? undefined
                                : { width: `${downloadPercent}%` }
                            }
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
              {mode === "advanced" && showExactBounds && manifest && (
                <svg
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-20 size-full"
                  preserveAspectRatio="none"
                  viewBox={`0 0 ${cardWidth} ${cardHeight}`}
                >
                  {manifest.elements.map(({ bounds, layerId, order }) =>
                    bounds ? (
                      <rect
                        fill="none"
                        key={`${order}:${layerId}`}
                        height={bounds.height}
                        stroke="rgba(255, 32, 96, 0.9)"
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                        width={bounds.width}
                        x={bounds.x}
                        y={bounds.y}
                      />
                    ) : null,
                  )}
                </svg>
              )}
              {mode === "advanced" && showTextInteractionBounds && (
                <svg
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-20 size-full"
                  preserveAspectRatio="none"
                  viewBox={`0 0 ${cardWidth} ${cardHeight}`}
                >
                  {textBounds.map(({ field, region }, index) => (
                    <rect
                      fill="none"
                      key={`${field ?? "text"}:${index}`}
                      height={region.height}
                      stroke="rgba(0, 196, 255, 0.95)"
                      strokeDasharray="4 3"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                      width={region.width}
                      x={region.x}
                      y={region.y}
                    />
                  ))}
                </svg>
              )}
              {reference && comparisonMode === "overlay" && (
                <img
                  alt="Selected reference overlay"
                  className="pointer-events-none absolute inset-0 block size-full object-fill"
                  src={reference.src}
                  style={{
                    opacity: referenceOpacity / 100,
                    transform: `translate(${(reference.transform.x / cardWidth) * 100}%, ${(reference.transform.y / cardHeight) * 100}%) rotate(${reference.transform.rotation}deg) scale(${reference.transform.scaleX / 100}, ${reference.transform.scaleY / 100})`,
                  }}
                />
              )}
            </div>
          </motion.figure>
          <AnimatePresence initial={false}>
            {reference && sideBySide && (
              <motion.figure
                animate={{
                  height: newCardBusy ? "0%" : "100%",
                  marginLeft: newCardBusy ? 0 : gapShare,
                  opacity: newCardBusy ? 0 : 1,
                  width: newCardBusy ? "0%" : cardShare,
                }}
                className="min-w-0 shrink-0 overflow-hidden"
                exit={{ height: "0%", marginLeft: 0, opacity: 0, width: 0 }}
                initial={{ height: "0%", marginLeft: 0, opacity: 0, width: 0 }}
                key={reference.id}
                transition={spring.moderate}
              >
                <img
                  alt={`Reference ${reference.name}`}
                  className="shadow-surface-4 block size-full object-fill"
                  src={reference.src}
                  style={{ aspectRatio }}
                />
              </motion.figure>
            )}
          </AnimatePresence>
        </div>
      </PreviewPlayground>
    </Elevated>
  )
}
