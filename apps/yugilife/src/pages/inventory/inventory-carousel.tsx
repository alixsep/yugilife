import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import { animate, AnimatePresence, motion, useMotionValue, useTransform } from "framer-motion"
import {
  ChevronLeft,
  ChevronRight,
  GalleryVerticalEnd,
  ImageOff,
  Pencil,
  Trash2,
} from "lucide-react"
import { Link } from "react-router"

import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useShape } from "@/lib/shape-context"
import { fade, spring } from "@/lib/springs"
import { cn } from "@/lib/utils"

import { cardRenderingLoopMs, CardRenderingSkeleton } from "./card-rendering-skeleton"

import type { InventoryCardSummary } from "./model/inventory-card"
import type { MotionValue, PanInfo } from "framer-motion"

/** The face fades out first and the sweep follows it in; on the way out the sweep clears first. */
const stageDelay = 0.1

function updatedOn(timestamp: number) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

/**
 * Holds a flag true long enough for the sweep to finish a full pass.
 *
 * A card can finish rendering in a couple of hundred milliseconds, which would tear the animation
 * down mid-wave. The work is never delayed by this — only the card's own face waits, so a bulk
 * refresh keeps running underneath and several cards can be mid-sweep at once.
 */
function useHeldFlag(active: boolean, minimumMs: number) {
  const [held, setHeld] = useState(false)
  const startedAt = useRef(0)

  // Both transitions are raised from a callback rather than synchronously in the effect body, so
  // neither cascades a render — the same shape the tooltip uses for its deferred unmount.
  useEffect(() => {
    if (!active) return
    startedAt.current = Date.now()
    const frame = requestAnimationFrame(() => setHeld(true))
    return () => cancelAnimationFrame(frame)
  }, [active])

  useEffect(() => {
    if (active) return
    const remaining = Math.max(0, startedAt.current + minimumMs - Date.now())
    const timeout = window.setTimeout(() => setHeld(false), remaining)
    return () => window.clearTimeout(timeout)
  }, [active, minimumMs])

  return active || held
}

interface InventoryCarouselProps {
  busy: boolean
  cards: readonly InventoryCardSummary[]
  onDelete: (cardId: string) => void
  onDuplicate: (cardId: string) => void
  onSelect: (cardId: string) => void
  previewUrls: Readonly<Record<string, string>>
  /** The card whose preview is being re-rendered, shown as a skeleton until it lands. */
  renderingCardId?: string | undefined
  selectedCardId?: string | undefined
}

interface CarouselPosition {
  filter: MotionValue<string>
  overlay: MotionValue<string>
  rotate: MotionValue<number>
  x: MotionValue<string>
  y: MotionValue<string>
  zIndex: MotionValue<number>
}

interface CarouselGeometry {
  curveDivisor: number
  stepPx: number
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

function useCarouselPosition(
  index: number,
  progress: MotionValue<number>,
  curveDivisor: number,
  itemCount: number,
): CarouselPosition {
  const relativePosition = useTransform(progress, (active) => index - active)
  const x = useTransform(relativePosition, (position) => `${position * (800 / curveDivisor)}%`)
  const y = useTransform(relativePosition, (position) => `${position * (200 / curveDivisor)}%`)
  const rotate = useTransform(relativePosition, (position) => position * (120 / curveDivisor))
  const filter = useTransform(
    relativePosition,
    (position) => `blur(${clamp(Math.abs(position) * 0.48, 0, 2.6)}px)`,
  )
  const overlay = useTransform(
    relativePosition,
    (position) => `rgb(0 0 0 / ${clamp(Math.abs(position) * 0.075, 0, 0.38)})`,
  )
  const zIndex = useTransform(relativePosition, (position) => itemCount + 4 - Math.abs(position))
  return { filter, overlay, rotate, x, y, zIndex }
}

function PositionedCard({
  busy,
  card,
  curveDivisor,
  index,
  itemCount,
  onDelete,
  onDuplicate,
  onSelect,
  previewUrl,
  previewUnavailableLabel,
  progress,
  rendering,
  selected,
  suppressClick,
}: {
  busy: boolean
  card: InventoryCardSummary
  curveDivisor: number
  index: number
  itemCount: number
  onDelete: () => void
  onDuplicate: () => void
  onSelect: () => void
  previewUrl?: string | undefined
  previewUnavailableLabel: string
  progress: MotionValue<number>
  rendering: boolean
  selected: boolean
  suppressClick: () => boolean
}) {
  const shape = useShape()
  const redrawing = useHeldFlag(rendering, cardRenderingLoopMs)
  const position = useCarouselPosition(index, progress, curveDivisor, itemCount)
  const { overlay, ...motionStyle } = position
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <motion.div
        className="pointer-events-none relative aspect-[813/1185] max-h-full w-[min(58vw,37dvh,19.875rem)] shrink-0"
        style={{ ...motionStyle, transformOrigin: "0% 100%" }}
      >
        <span
          className={cn(
            "text-title text-foreground bg-surface-3 absolute bottom-full left-0 mb-2 px-1.5 py-1 font-bold tabular-nums",
            shape.item,
          )}
        >
          {String(index + 1).padStart(2, "0")}
        </span>
        {/* The card's own actions ride with it, opposite its number. Only the settled card offers
            them: every other card is turned away and partly behind its neighbour, so a control
            there would be aimed at a target the reader cannot fully see. */}
        <AnimatePresence>
          {selected && (
            <motion.div
              animate={{ opacity: 1 }}
              className={cn(
                "bg-surface-3 pointer-events-auto absolute right-0 bottom-full mb-2 flex items-center gap-0.5 p-0.5",
                shape.item,
              )}
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              key="actions"
              transition={fade}
              // A drag that happens to start on a control still ends in a click on it. The card face
              // already ignores that; these do too, or a flick of the gallery opens the editor.
              onClickCapture={(event) => {
                if (!suppressClick()) return
                event.preventDefault()
                event.stopPropagation()
              }}
            >
              <Button asChild leadingIcon={Pencil} size="compact" variant="ghost">
                <Link to={`/build/${encodeURIComponent(card.id)}`}>Edit</Link>
              </Button>
              <ConfirmDialog
                confirmLabel="Duplicate card"
                description={`A copy of “${card.title}” will be added to your inventory.`}
                disabled={busy}
                onConfirm={onDuplicate}
                title="Duplicate this card?"
                trigger={
                  <Button leadingIcon={GalleryVerticalEnd} size="compact" variant="ghost">
                    Duplicate
                  </Button>
                }
              />
              <ConfirmDialog
                confirmLabel="Delete card"
                description={`“${card.title}” will be permanently removed from this browser.`}
                disabled={busy}
                onConfirm={onDelete}
                title="Delete this card?"
                trigger={
                  <Button
                    aria-label="Delete card"
                    className="text-destructive hover:text-destructive"
                    size="icon-compact"
                    variant="ghost"
                  >
                    <Trash2 />
                  </Button>
                }
              />
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {selected && (
            <motion.div
              animate={{ opacity: 1 }}
              className="absolute inset-x-0 top-full mt-2 flex justify-center"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              key="detail"
              transition={fade}
            >
              <span
                className={cn(
                  "text-caption text-muted-foreground bg-surface-3 max-w-full truncate px-1.5 py-1",
                  shape.item,
                )}
              >
                {card.templateId} · Updated {updatedOn(card.updatedAt)}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
        <button
          aria-label={`${card.title}${selected ? ", selected" : ""}`}
          aria-pressed={selected}
          className={cn(
            "pointer-events-auto relative size-full cursor-grab overflow-hidden rounded-none transition-[box-shadow] duration-300 outline-none select-none active:cursor-grabbing",
            redrawing ? "shadow-none" : selected ? "shadow-surface-7" : "shadow-surface-4",
          )}
          onClick={() => {
            if (!suppressClick()) onSelect()
          }}
          type="button"
        >
          {/* The card's surface travels with its face: both clear out of the sweep's way together,
              so the tiles never sit inside a leftover bordered box. */}
          <motion.span
            animate={{ opacity: redrawing ? 0 : 1 }}
            aria-hidden="true"
            className={cn(
              "bg-surface-2 absolute inset-0",
              !previewUrl && cn("border-border border", shape.container),
            )}
            initial={false}
            transition={redrawing ? fade : { ...fade, delay: stageDelay }}
          />
          {/* The face stays mounted and only fades while a render is running, so the sweep is an
              overlay on this card rather than a third thing swapping in and out of its place. */}
          <AnimatePresence initial={false}>
            {previewUrl ? (
              <motion.img
                alt=""
                animate={{ opacity: redrawing ? 0 : 1 }}
                className="pointer-events-none absolute inset-0 size-full object-cover"
                draggable={false}
                exit={{ opacity: 0 }}
                initial={{ opacity: 0 }}
                key={previewUrl}
                src={previewUrl}
                transition={redrawing ? fade : { ...fade, delay: stageDelay }}
              />
            ) : (
              <motion.span
                animate={{ opacity: redrawing ? 0 : 1 }}
                className="text-muted-foreground absolute inset-0 flex flex-col items-center justify-center gap-2 px-5 text-center"
                exit={{ opacity: 0 }}
                initial={{ opacity: 0 }}
                key="unavailable"
                transition={redrawing ? fade : { ...fade, delay: stageDelay }}
              >
                <ImageOff aria-hidden="true" className="size-5" strokeWidth={1.5} />
                <span className="text-caption">{previewUnavailableLabel}</span>
              </motion.span>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {redrawing && (
              <motion.span
                animate={{ opacity: 1, transition: { ...fade, delay: stageDelay } }}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                exit={{ opacity: 0, transition: fade }}
                initial={{ opacity: 0 }}
                key="rendering"
              >
                <CardRenderingSkeleton />
              </motion.span>
            )}
          </AnimatePresence>
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ background: overlay }}
          />
        </button>
      </motion.div>
    </div>
  )
}

export function InventoryCarousel({
  busy,
  cards,
  onDelete,
  onDuplicate,
  onSelect,
  previewUrls,
  renderingCardId,
  selectedCardId,
}: InventoryCarouselProps) {
  const stageRef = useRef<HTMLElement>(null)
  const gestureStart = useRef(0)
  const dragged = useRef(false)
  const animation = useRef<ReturnType<typeof animate>>(undefined)
  const animationSequence = useRef(0)
  const selectedIndex = Math.max(
    0,
    cards.findIndex(({ id }) => id === selectedCardId),
  )
  const itemCount = cards.length
  const progress = useMotionValue(selectedIndex)
  const [settledIndex, setSettledIndex] = useState(selectedIndex)
  const [renderIndex, setRenderIndex] = useState(selectedIndex)
  const [geometry, setGeometry] = useState<CarouselGeometry>({
    curveDivisor: 12,
    stepPx: 120,
  })

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const measure = () => {
      const rect = stage.getBoundingClientRect()
      const cardWidth = Math.min(
        rect.width * 0.58,
        window.innerHeight * 0.37,
        rect.height * (813 / 1185),
        318,
      )
      const slots = Math.min(Math.max(itemCount + 1, 3), 7)
      const availableStep = (rect.width / slots) * 0.8
      const stepPx = clamp(availableStep, cardWidth * 0.28, cardWidth * 0.6)
      setGeometry({ curveDivisor: (cardWidth * 8) / stepPx, stepPx })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [itemCount])

  const settleTo = useCallback(
    (requestedIndex: number) => {
      const target = clamp(Math.round(requestedIndex), 0, itemCount - 1)
      animation.current?.stop()
      const sequence = ++animationSequence.current
      setRenderIndex(target)
      animation.current = animate(progress, target, spring.moderate)
      void animation.current.then(() => {
        if (sequence !== animationSequence.current) return
        setSettledIndex(target)
        const card = cards[target]
        if (card) onSelect(card.id)
      })
    },
    [cards, itemCount, onSelect, progress],
  )

  const move = useCallback(
    (direction: -1 | 1) => settleTo(Math.round(progress.get()) + direction),
    [progress, settleTo],
  )

  /**
   * Follows a selection made outside the carousel — a duplicate, a delete, the first card after a
   * reload. When the selection changed because this carousel just settled there, it is a no-op.
   *
   * This is why the carousel is not keyed on the selected card upstream: remounting to re-seed the
   * scroll position would also tear down every card's own state, restarting in-flight animations
   * the moment a drag settles.
   */
  useEffect(() => {
    if (selectedIndex === settledIndex) return
    // Deferred a frame because settling updates state; running it inline would cascade a render.
    const frame = requestAnimationFrame(() => settleTo(selectedIndex))
    return () => cancelAnimationFrame(frame)
  }, [selectedIndex, settledIndex, settleTo])

  const handlePan = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (Math.abs(info.offset.x) > 3) dragged.current = true
    const next = clamp(gestureStart.current - info.offset.x / geometry.stepPx, 0, itemCount - 1)
    progress.set(next)
    const nextRenderIndex = Math.round(next)
    if (nextRenderIndex !== renderIndex) setRenderIndex(nextRenderIndex)
  }

  const handlePanEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const projected = progress.get() - (info.velocity.x / geometry.stepPx) * 0.14
    settleTo(projected)
    window.setTimeout(() => {
      dragged.current = false
    }, 0)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && target.closest("[role='dialog'], [role='menu']")) return
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        move(-1)
      }
      if (event.key === "ArrowRight") {
        event.preventDefault()
        move(1)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [move])

  const visibleCards = useMemo(
    () =>
      cards
        .map((card, index) => ({ card, index }))
        .filter(({ index }) => Math.abs(index - renderIndex) <= 6),
    [cards, renderIndex],
  )

  return (
    <motion.section
      aria-label="Card collection. Drag or use the left and right arrow keys to browse."
      className="absolute inset-0 touch-pan-y"
      onPan={handlePan}
      onPanEnd={handlePanEnd}
      onPanStart={() => {
        animation.current?.stop()
        animationSequence.current += 1
        gestureStart.current = progress.get()
        dragged.current = false
      }}
      ref={stageRef}
    >
      <div className="relative size-full" aria-live="polite">
        {visibleCards.map(({ card, index }) => (
          <PositionedCard
            busy={busy}
            card={card}
            curveDivisor={geometry.curveDivisor}
            index={index}
            itemCount={itemCount}
            key={card.id}
            onDelete={() => onDelete(card.id)}
            onDuplicate={() => onDuplicate(card.id)}
            onSelect={() => settleTo(index)}
            previewUrl={previewUrls[card.id]}
            previewUnavailableLabel={busy ? "Restoring preview…" : "Preview unavailable"}
            progress={progress}
            rendering={renderingCardId === card.id}
            selected={settledIndex === index}
            suppressClick={() => dragged.current}
          />
        ))}
      </div>

      {itemCount > 1 && (
        <div className="pointer-events-none absolute inset-x-3 top-1/2 z-30 flex -translate-y-1/2 justify-between sm:inset-x-5">
          <Button
            aria-label="Previous card"
            className="pointer-events-auto"
            disabled={settledIndex <= 0}
            onClick={() => move(-1)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ChevronLeft />
          </Button>
          <Button
            aria-label="Next card"
            className="pointer-events-auto"
            disabled={settledIndex >= itemCount - 1}
            onClick={() => move(1)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ChevronRight />
          </Button>
        </div>
      )}
    </motion.section>
  )
}
