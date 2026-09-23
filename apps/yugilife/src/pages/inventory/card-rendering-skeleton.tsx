import { useShape } from "@/lib/shape-context"
import { cn } from "@/lib/utils"

import type { CSSProperties } from "react"

/** Close to the card's own 813:1185 proportion, so the tiles stay near-square. */
const columns = 11
const rows = 16
/** How long the wave takes to cross the card, corner to corner. */
const sweepMs = 990
/** One full pass of a single tile through the keyframe. */
const cycleMs = 1600

const tiles = Array.from({ length: columns * rows }, (_, index) => ({
  // The sweep runs corner to corner, so a tile's offset is its distance along the diagonal.
  diagonal: (index % columns) + Math.floor(index / columns),
  index,
}))
const tileStepMs = Math.round(sweepMs / (columns + rows - 2))

/**
 * How long the skeleton must stay on screen to look deliberate: long enough for the wave to reach
 * the last tile and for that tile to complete a full cycle. Cut short of this, the sweep stops
 * mid-pass and reads as a glitch rather than as a transition.
 */
export const cardRenderingLoopMs = sweepMs + cycleMs

/**
 * Stands in for a card while its preview is being rendered. It is a card-shaped tile grid rather
 * than a spinner because it occupies the exact space the finished card will, so the swap is a
 * crossfade in place instead of a layout change.
 *
 * Every tile shares one keyframe and differs only by its delay, so the whole grid costs a single
 * compositor pass no matter how many tiles it has.
 */
export function CardRenderingSkeleton({ className }: { className?: string }) {
  const shape = useShape()
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-full grid-cols-[repeat(11,minmax(0,1fr))] grid-rows-[repeat(16,minmax(0,1fr))] gap-[2px] p-[2px]",
        className,
      )}
      style={{ "--tile-cycle": `${cycleMs}ms`, "--tile-step": `${tileStepMs}ms` } as CSSProperties}
    >
      {tiles.map(({ diagonal, index }) => (
        <span
          className={cn("card-tile", shape.item)}
          key={index}
          style={{ "--tile-delay": diagonal } as CSSProperties}
        />
      ))}
    </span>
  )
}
