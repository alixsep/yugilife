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

import type { useBuildController } from "./use-build-controller"

interface CardPreviewProps {
  controller: ReturnType<typeof useBuildController>
}

export function CardPreview({ controller }: CardPreviewProps) {
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
            <div className="shadow-surface-7 relative size-full overflow-hidden">
              {templateBundle ? (
                <Card
                  card={renderCardData}
                  className="size-full"
                  debugLogging={mode === "advanced" && debugLoggingEnabled}
                  layers={layers}
                  presetOverrides={presetOverrides}
                  presentationOverrides={presentationOverrides}
                  templateBundle={templateBundle}
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
