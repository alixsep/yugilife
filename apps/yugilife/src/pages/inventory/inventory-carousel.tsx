import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import { animate, motion, useMotionValue, useTransform } from "framer-motion"
import { ChevronLeft, ChevronRight, ImageOff, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useShape } from "@/lib/shape-context"
import { spring } from "@/lib/springs"
import { cn } from "@/lib/utils"

import type { InventoryCardSummary } from "./model/inventory-card"
import type { MotionValue, PanInfo } from "framer-motion"

interface InventoryCarouselProps {
  busy: boolean
  cards: readonly InventoryCardSummary[]
  onCreate: () => void
  onCreateFocusChange: (focused: boolean) => void
  onSelect: (cardId: string) => void
  previewUrls: Readonly<Record<string, string>>
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
  card,
  curveDivisor,
  index,
  itemCount,
  onSelect,
  previewUrl,
  previewUnavailableLabel,
  progress,
  selected,
  suppressClick,
}: {
  card: InventoryCardSummary
  curveDivisor: number
  index: number
  itemCount: number
  onSelect: () => void
  previewUrl?: string | undefined
  previewUnavailableLabel: string
  progress: MotionValue<number>
  selected: boolean
  suppressClick: () => boolean
}) {
  const shape = useShape()
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
        <button
          aria-label={`${card.title}${selected ? ", selected" : ""}`}
          aria-pressed={selected}
          className={cn(
            "bg-surface-2 pointer-events-auto relative size-full cursor-grab overflow-hidden rounded-none border outline-none select-none active:cursor-grabbing",
            !previewUrl && shape.container,
            selected
              ? "shadow-surface-7 border-[color-mix(in_oklab,var(--focus-ring)_48%,var(--border))]"
              : "border-border shadow-surface-4",
          )}
          onClick={() => {
            if (!suppressClick()) onSelect()
          }}
          type="button"
        >
          {previewUrl ? (
            <img
              alt=""
              className="pointer-events-none size-full object-cover"
              draggable={false}
              src={previewUrl}
            />
          ) : (
            <span className="text-muted-foreground flex size-full flex-col items-center justify-center gap-2 px-5 text-center">
              <ImageOff aria-hidden="true" className="size-5" strokeWidth={1.5} />
              <span className="text-caption">{previewUnavailableLabel}</span>
            </span>
          )}
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

function PositionedCreateCard({
  busy,
  curveDivisor,
  index,
  itemCount,
  onCreate,
  progress,
  suppressClick,
}: {
  busy: boolean
  curveDivisor: number
  index: number
  itemCount: number
  onCreate: () => void
  progress: MotionValue<number>
  suppressClick: () => boolean
}) {
  const shape = useShape()
  const position = useCarouselPosition(index, progress, curveDivisor, itemCount)
  const { overlay, ...motionStyle } = position
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <motion.button
        aria-label="Create a new card"
        className={cn(
          "text-muted-foreground hover:text-foreground pointer-events-auto relative aspect-[813/1185] max-h-full w-[min(58vw,37dvh,19.875rem)] cursor-grab border-2 border-dashed bg-transparent transition-colors outline-none select-none active:cursor-grabbing",
          shape.container,
        )}
        disabled={busy}
        onClick={() => {
          if (!suppressClick()) onCreate()
        }}
        style={{ ...motionStyle, scale: 0.86, transformOrigin: "0% 100%" }}
        type="button"
      >
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: overlay }}
        />
        <Plus
          aria-hidden="true"
          className="absolute top-1/2 left-1/2 size-9 -translate-1/2"
          strokeWidth={1.25}
        />
      </motion.button>
    </div>
  )
}

export function InventoryCarousel({
  busy,
  cards,
  onCreate,
  onCreateFocusChange,
  onSelect,
  previewUrls,
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
  const itemCount = cards.length + 1
  const createIndex = cards.length
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
        onCreateFocusChange(target === createIndex)
        if (card) onSelect(card.id)
      })
    },
    [cards, createIndex, itemCount, onCreateFocusChange, onSelect, progress],
  )

  const move = useCallback(
    (direction: -1 | 1) => settleTo(Math.round(progress.get()) + direction),
    [progress, settleTo],
  )

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
            card={card}
            curveDivisor={geometry.curveDivisor}
            index={index}
            itemCount={itemCount}
            key={card.id}
            onSelect={() => settleTo(index)}
            previewUrl={previewUrls[card.id]}
            previewUnavailableLabel="Preview unavailable"
            progress={progress}
            selected={settledIndex === index}
            suppressClick={() => dragged.current}
          />
        ))}

        {Math.abs(createIndex - renderIndex) <= 6 && (
          <PositionedCreateCard
            busy={busy}
            curveDivisor={geometry.curveDivisor}
            index={createIndex}
            itemCount={itemCount}
            onCreate={onCreate}
            progress={progress}
            suppressClick={() => dragged.current}
          />
        )}
      </div>

      {itemCount > 1 && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-30 flex -translate-y-1/2 justify-between">
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
