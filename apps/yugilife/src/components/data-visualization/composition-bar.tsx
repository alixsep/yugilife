import { useState } from "react"

import { motion } from "framer-motion"

import { spring } from "@/lib/springs"
import { cn } from "@/lib/utils"

import { ChartFrame } from "./chart-frame"
import { formatNumber } from "./chart-scales"
import {
  CHART_DRAW,
  chartRampPosition,
  chartRampStep,
  chartStagger,
  FIGURE_TYPE,
  useChartMotion,
  useChartReveal,
  useRampInks,
} from "./chart-tokens"

import type { ChartGoal } from "./chart-frame"
import type { ReactNode } from "react"

export interface CompositionSegment {
  readonly id: string
  readonly label: string
  readonly value: number
  readonly note?: string
}

export interface CompositionBarProps {
  readonly title: string
  readonly description?: ReactNode
  /** Which direction on this chart is the good one. */
  readonly goal?: ChartGoal
  readonly segments: readonly CompositionSegment[]
  readonly format?: (value: number) => string
  readonly totalLabel?: string
  /** Overrides the summed total, for when the whole is quoted in different units to its parts. */
  readonly totalValue?: string
  readonly footnote?: ReactNode
}

const BAR_HEIGHT = 42
/**
 * Three pixels of the page separate touching segments, so neighbouring steps read as distinct
 * marks without a stroke around each one — separation as negative space rather than as ink.
 */
const SURFACE_GAP = 3
/** Below this a segment cannot hold its own value without crowding, so the list carries it alone. */
const INLINE_LABEL_MIN = 56

/**
 * A proportional stacked bar for part-to-whole. The parts wear one accent-derived hue stepped
 * light to dark, because they are pieces of a single measurement rather than four unrelated
 * things.
 *
 * The ramp follows the caller's order, so pass stages in the order they run: sorting a sequence by
 * size throws the sequence away. The list under the bar is the legend, the direct labelling, and
 * the relief channel for an accent whose contrast cannot be checked ahead of time, all at once.
 */
export function CompositionBar({
  description,
  footnote,
  goal,
  format = (value) => formatNumber(value),
  segments,
  title,
  totalLabel = "Total",
  totalValue,
}: CompositionBarProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const reduceMotion = useChartMotion()
  const [revealRef, revealed] = useChartReveal<HTMLDivElement>()
  const inks = useRampInks()
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  const share = (value: number) => (total === 0 ? 0 : value / total)
  const percent = (value: number) => `${(share(value) * 100).toFixed(1)}%`

  return (
    <ChartFrame
      columns={[
        { key: "label", label: "Part" },
        { key: "value", label: "Value", numeric: true },
        { key: "share", label: "Share", numeric: true },
      ]}
      description={description}
      footnote={footnote}
      goal={goal}
      // This figure has no table view: the list under the bar already names every part and prints
      // both its value and its share, and the total is spelled out under them. A disclosure here
      // would open onto the numbers the reader is already looking at.
      tableView={false}
      rows={[
        ...segments.map((segment) => [
          segment.label,
          format(segment.value),
          percent(segment.value),
        ]),
        [totalLabel, totalValue ?? format(total), "100.0%"],
      ]}
      title={title}
    >
      {(width) => {
        const gaps = SURFACE_GAP * Math.max(0, segments.length - 1)
        const usable = Math.max(1, width - gaps)
        let cursor = 0
        const placed = segments.map((segment, index) => {
          const segmentWidth = Math.max(0, share(segment.value) * usable)
          const x = cursor
          cursor += segmentWidth + SURFACE_GAP
          const position = chartRampPosition(index, segments.length)
          return {
            color: chartRampStep(index, segments.length),
            ink: inks[position] ?? "var(--user-accent-foreground)",
            segment,
            segmentWidth,
            x,
          }
        })

        return (
          <div>
            <div className="relative" ref={revealRef} style={{ height: BAR_HEIGHT }}>
              {placed.map(({ color, ink, segment, segmentWidth, x }, index) => {
                const isHovered = hovered === segment.id
                return (
                  <motion.button
                    animate={{ opacity: hovered !== null && !isHovered ? 0.45 : 1 }}
                    className="absolute top-0 cursor-default overflow-hidden rounded-md border-none bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-(--focus-ring) focus-visible:ring-offset-2 focus-visible:ring-offset-(--background)"
                    initial={false}
                    key={segment.id}
                    onBlur={() => setHovered(null)}
                    onFocus={() => setHovered(segment.id)}
                    onPointerEnter={() => setHovered(segment.id)}
                    onPointerLeave={() => setHovered(null)}
                    // The button is sized from the data, never from its contents: a label inside it
                    // must not be able to change how much of the whole this part appears to be.
                    style={{ height: BAR_HEIGHT, left: x, width: segmentWidth }}
                    transition={reduceMotion ? { duration: 0 } : spring.fast}
                    type="button"
                  >
                    {/* The fill is the animated child, so the bar assembles left to right as it
                        scrolls into view instead of appearing fully formed. */}
                    <motion.span
                      animate={{ width: revealed || reduceMotion ? segmentWidth : 0 }}
                      className="absolute top-0 left-0 block"
                      initial={false}
                      style={{ backgroundColor: color, height: BAR_HEIGHT }}
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : { ...spring.slow, delay: chartStagger(index, reduceMotion) }
                      }
                    />
                    {/* The measurement rides its own segment, not the share: the width of the
                        segment is already the share, and printing it inside says the same thing
                        twice while leaving the quantity the parts actually sum to invisible. The
                        ink is measured against the step it sits on rather than assumed, so the
                        darker end of the ramp keeps its label instead of losing it. */}
                    {segmentWidth >= INLINE_LABEL_MIN && (
                      <motion.span
                        animate={{ opacity: revealed || reduceMotion ? 1 : 0 }}
                        className={cn(
                          FIGURE_TYPE.value,
                          "absolute inset-0 grid place-items-center tabular-nums",
                        )}
                        initial={false}
                        style={{ color: ink }}
                        transition={
                          reduceMotion
                            ? { duration: 0 }
                            : {
                                delay:
                                  chartStagger(index, reduceMotion) + CHART_DRAW.afterBar.delay,
                                duration: CHART_DRAW.afterBar.duration,
                              }
                        }
                      >
                        {format(segment.value)}
                      </motion.span>
                    )}
                    <span className="sr-only">
                      {`${segment.label}: ${format(segment.value)}, ${percent(segment.value)}`}
                    </span>
                  </motion.button>
                )
              })}
            </div>

            {/* One column, not two. The parts add up to the total underneath them, and that only
                reads as arithmetic if every figure sits in the same right-hand column as the sum.
                Two columns scatter the numbers across the width and leave an odd count ragged.
                No rules between the rows either: space separates them, and a grid of hairlines
                turns a short list into a spreadsheet. */}
            <div className="mt-5 grid gap-y-3">
              {placed.map(({ color, segment }) => {
                const isHovered = hovered === segment.id
                return (
                  <div
                    className={cn(
                      "flex items-baseline gap-3 transition-opacity",
                      hovered !== null && !isHovered && "opacity-45",
                    )}
                    key={segment.id}
                    onPointerEnter={() => setHovered(segment.id)}
                    onPointerLeave={() => setHovered(null)}
                  >
                    <span
                      aria-hidden="true"
                      className="h-3.5 w-1 shrink-0 translate-y-1 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={cn(FIGURE_TYPE.label, "text-foreground block truncate")}>
                        {segment.label}
                      </span>
                      {/* `note`, not `axis`: axis type is for ticks inside the SVG, and this is
                          the quiet second line under a label like any other. */}
                      {segment.note !== undefined && (
                        <span
                          className={cn(
                            FIGURE_TYPE.note,
                            "text-muted-foreground mt-0.5 block truncate",
                          )}
                        >
                          {segment.note}
                        </span>
                      )}
                    </span>
                    {/* The share follows the value here because the bar stopped carrying it, and
                        it stays quiet: it is the reading the eye already took off the width. */}
                    <span
                      className={cn(
                        FIGURE_TYPE.note,
                        "text-muted-foreground w-12 shrink-0 text-right tabular-nums",
                      )}
                    >
                      {percent(segment.value)}
                    </span>
                    <span
                      className={cn(
                        FIGURE_TYPE.value,
                        "text-foreground w-16 shrink-0 text-right tabular-nums",
                      )}
                    >
                      {format(segment.value)}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* The total gets the one rule in this figure. Without it the row reads as a fourth
                part rather than the sum of the three above, which is the whole point of a
                part-to-whole: a reader should never have to add the list up to check. */}
            <div className="border-border mt-5 flex items-baseline justify-between border-t pt-3.5">
              <span className={cn(FIGURE_TYPE.label, "text-foreground")}>{totalLabel}</span>
              <span
                className={cn(
                  FIGURE_TYPE.value,
                  "text-foreground w-16 shrink-0 text-right tabular-nums",
                )}
              >
                {totalValue ?? format(total)}
              </span>
            </div>
          </div>
        )
      }}
    </ChartFrame>
  )
}
