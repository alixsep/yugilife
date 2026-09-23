import { useId, useLayoutEffect, useRef, useState } from "react"

import { AnimatePresence, motion } from "framer-motion"
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  ChevronDown,
} from "lucide-react"

import { spring } from "@/lib/springs"
import { cn } from "@/lib/utils"

import {
  CHART_ACCENT,
  FIGURE_TYPE,
  useChartMotion,
  useChartReveal,
  useMeasuredWidth,
} from "./chart-tokens"
import { DataTable } from "./data-table"

import type { DataTableColumn } from "./data-table"
import type { ReactNode } from "react"

/**
 * Which way is good. A reader can see which mark is highest and still not know whether highest is
 * the win, so the direction is named once, in the same words on every figure.
 */
export type ChartGoalDirection =
  "lower" | "higher" | "lower-left" | "lower-right" | "upper-left" | "upper-right"

export interface ChartGoal {
  readonly direction: ChartGoalDirection
  /** Overrides the sentence the direction implies, for a measure with a name worth repeating. */
  readonly label?: ReactNode
}

const GOAL_ARROW = {
  higher: ArrowUp,
  lower: ArrowDown,
  "lower-left": ArrowDownLeft,
  "lower-right": ArrowDownRight,
  "upper-left": ArrowUpLeft,
  "upper-right": ArrowUpRight,
} as const

/**
 * A diagonal names the corner it points at rather than the journey there — which is also what the
 * shaded quarter is called on a quartered plot.
 */
const GOAL_LABEL = {
  higher: "Higher is better",
  lower: "Lower is better",
  "lower-left": "Bottom left is better",
  "lower-right": "Bottom right is better",
  "upper-left": "Top left is better",
  "upper-right": "Top right is better",
} as const

/** The unit vector each arrow travels along, in screen space, where y counts downward. */
const GOAL_VECTOR = {
  higher: { x: 0, y: -1 },
  lower: { x: 0, y: 1 },
  "lower-left": { x: -1, y: 1 },
  "lower-right": { x: 1, y: 1 },
  "upper-left": { x: -1, y: -1 },
  "upper-right": { x: 1, y: -1 },
} as const

const GOAL_ICON = 12
/** The window the ribbon runs through: the icon plus a little air, no more. */
const GOAL_WINDOW = 18
/** Gap between arrows. Shorter than the window, so one is always entering as another leaves. */
const GOAL_PITCH = 14
/** Enough copies to fill the window at any offset, including across a diagonal's longer reach. */
const GOAL_COPIES = 5
/** Time to advance exactly one pitch, which is one full period of the loop. */
const GOAL_LOOP_SECONDS = 1.1
const GOAL_FADE = (angle: number) =>
  `linear-gradient(${angle}deg, transparent, #000 24%, #000 76%, transparent)`

/**
 * The direction marker: a ribbon of arrows running the way the goal is, plus its sentence.
 *
 * The strip advances by exactly one gap per cycle, so the frame after the last is identical to the
 * first and the loop has no seam. It is clipped rather than travelling, and the window is masked
 * rather than cut so an arrow fades at an edge instead of being guillotined.
 */
export function ChartGoalMarker({ goal }: { readonly goal: ChartGoal }) {
  const reduceMotion = useChartMotion()
  const [revealRef, revealed] = useChartReveal<HTMLDivElement>()
  const Arrow = GOAL_ARROW[goal.direction]
  const vector = GOAL_VECTOR[goal.direction]
  const running = revealed && !reduceMotion

  // A diagonal's unit step is shorter on each axis than a straight one's, so the arrows along it
  // are spaced by the same distance rather than half again as much.
  const length = Math.hypot(vector.x, vector.y)
  const step = { x: (vector.x / length) * GOAL_PITCH, y: (vector.y / length) * GOAL_PITCH }
  // CSS gradient angles start at "to top" and turn clockwise, which is what the arrow's own
  // direction becomes once the downward y is flipped.
  const fadeAngle = (Math.atan2(vector.x, -vector.y) * 180) / Math.PI
  const middle = (GOAL_COPIES - 1) / 2

  return (
    <div
      className={cn(FIGURE_TYPE.table, "text-muted-foreground mt-3 inline-flex items-center gap-1")}
      ref={revealRef}
    >
      <span
        aria-hidden="true"
        className="relative block shrink-0 overflow-hidden"
        style={{
          height: GOAL_WINDOW,
          maskImage: GOAL_FADE(fadeAngle),
          WebkitMaskImage: GOAL_FADE(fadeAngle),
          width: GOAL_WINDOW,
        }}
      >
        <motion.span
          animate={running ? { x: [0, step.x], y: [0, step.y] } : { x: 0, y: 0 }}
          className="absolute inset-0 block"
          initial={false}
          transition={
            running
              ? { duration: GOAL_LOOP_SECONDS, ease: "linear", repeat: Infinity }
              : { duration: 0 }
          }
        >
          {/* Centred on the middle copy, so a ribbon that is not running still shows one arrow in
              the middle of its window rather than an empty box. */}
          {Array.from({ length: GOAL_COPIES }, (_, index) => (
            <span
              className="absolute inset-0 grid place-items-center"
              key={index}
              style={{
                transform: `translate(${(index - middle) * step.x}px, ${(index - middle) * step.y}px)`,
              }}
            >
              <Arrow size={GOAL_ICON} strokeWidth={2} />
            </span>
          ))}
        </motion.span>
      </span>
      {goal.label ?? GOAL_LABEL[goal.direction]}
    </div>
  )
}

export interface ChartQuadrants {
  /** Which of the four corners a point would have to reach to be a win. */
  readonly goal: "lower-left" | "lower-right" | "upper-left" | "upper-right"
  /** Where the plot splits, in data units. Defaults to the middle of each axis. */
  readonly x?: number
  readonly y?: number
  readonly label: string
}

/**
 * Splits a plot into four and shades the corner that would be a win, which is what makes an empty
 * corner visible. Drawn under the bands and the marks so the quarters are never mistaken for one.
 */
export function ChartQuadrantLayer({
  hideXSplit = false,
  plot,
  quadrants,
  scaleX,
  scaleY,
  xDomain,
  yDomain,
}: {
  /** Set when a budget or annotation line already stands at the split, to avoid doubling it. */
  readonly hideXSplit?: boolean
  readonly plot: {
    readonly bottom: number
    readonly left: number
    readonly right: number
    readonly top: number
  }
  readonly quadrants: ChartQuadrants
  readonly scaleX: (value: number) => number
  readonly scaleY: (value: number) => number
  readonly xDomain: readonly [number, number]
  readonly yDomain: readonly [number, number]
}) {
  const cutX = scaleX(quadrants.x ?? (xDomain[0] + xDomain[1]) / 2)
  const cutY = scaleY(quadrants.y ?? (yDomain[0] + yDomain[1]) / 2)
  const wantsLeft = quadrants.goal.endsWith("left")
  const wantsLower = quadrants.goal.startsWith("lower")
  const zoneX = wantsLeft ? plot.left : cutX
  const zoneWidth = wantsLeft ? cutX - plot.left : plot.right - cutX
  const zoneY = wantsLower ? cutY : plot.top
  const zoneHeight = wantsLower ? plot.bottom - cutY : cutY - plot.top

  return (
    <g>
      <rect
        fill={CHART_ACCENT}
        height={Math.max(0, zoneHeight)}
        opacity={0.12}
        width={Math.max(0, zoneWidth)}
        x={zoneX}
        y={zoneY}
      />
      {/* The split itself, drawn across the whole plot so all four quarters read as verdicts
          rather than one shaded box floating in a corner. */}
      {!hideXSplit && (
        <line
          stroke="var(--chart-muted)"
          strokeDasharray="4 3"
          strokeWidth={1}
          x1={cutX}
          x2={cutX}
          y1={plot.top}
          y2={plot.bottom}
        />
      )}
      <line
        stroke="var(--chart-muted)"
        strokeDasharray="4 3"
        strokeWidth={1}
        x1={plot.left}
        x2={plot.right}
        y1={cutY}
        y2={cutY}
      />
      {/* The label sits in the quarter's outer corner — the far corner of the goal, the one the
          direction marker points at — rather than wherever there happened to be room. A quarter
          too short to hold it is named by that marker alone. */}
      {zoneHeight >= 20 && (
        <text
          className={cn(FIGURE_TYPE.axis, "fill-muted-foreground")}
          dominantBaseline={wantsLower ? "auto" : "hanging"}
          textAnchor={wantsLeft ? "start" : "end"}
          x={wantsLeft ? zoneX + 8 : zoneX + zoneWidth - 8}
          y={wantsLower ? zoneY + zoneHeight - 7 : zoneY + 6}
        >
          {quadrants.label}
        </text>
      )}
    </g>
  )
}

export interface ChartFrameProps {
  readonly title: string
  readonly description?: ReactNode
  /** Which direction on this chart is the good one, stated above the plot. */
  readonly goal?: ChartGoal | undefined
  /**
   * The table view. Every chart ships one: it is the keyboard-free route to values a tooltip would
   * otherwise gate, and the relief channel for a user-chosen accent whose contrast against the
   * surface cannot be checked ahead of time. Pass a readable sample, not a hundred rows.
   */
  readonly columns: readonly DataTableColumn[]
  readonly rows: readonly (readonly (string | number)[])[]
  /** Set false only where the plot already prints every value on the page. */
  readonly tableView?: boolean
  /** Shown under the table when its rows are a sample of a larger series. */
  readonly tableNote?: ReactNode
  readonly footnote?: ReactNode
  readonly children: (width: number) => ReactNode
  readonly className?: string
}

/**
 * The shell every chart in this directory renders into: heading, plot area, and the table view.
 * No card around it — a chart already sits inside a measured column, and a second bordered box
 * only takes width from the plot.
 *
 * Titles are a plain element with an explicit level rather than an `<h3>`, so a chart dropped into
 * prose does not inherit the article's heading type scale.
 */
export function ChartFrame({
  children,
  className,
  columns,
  description,
  footnote,
  goal,
  rows,
  tableNote,
  tableView = true,
  title,
}: ChartFrameProps) {
  const [containerRef, width] = useMeasuredWidth<HTMLDivElement>()
  const titleId = useId()
  const tableId = useId()
  const [showTable, setShowTable] = useState(false)
  const reduceMotion = useChartMotion()

  return (
    <figure aria-labelledby={titleId} className={cn("!my-12", className)}>
      <div
        aria-level={3}
        className={cn(FIGURE_TYPE.title, "text-foreground")}
        id={titleId}
        role="heading"
      >
        {title}
      </div>
      {description !== undefined && (
        <div className={cn(FIGURE_TYPE.description, "text-muted-foreground mt-1.5 max-w-[60ch]")}>
          {description}
        </div>
      )}
      {/* Directly above the plot rather than tucked into the footnote: it is the instruction for
          reading the marks, so it has to arrive before them. */}
      {goal !== undefined && <ChartGoalMarker goal={goal} />}
      <div className="mt-6" ref={containerRef}>
        {width > 0 && children(width)}
      </div>
      {footnote !== undefined && (
        <div className={cn(FIGURE_TYPE.footnote, "text-muted-foreground mt-5 max-w-[60ch]")}>
          {footnote}
        </div>
      )}
      {/* The rule that closes the figure off from the prose under it. */}
      {tableView && (
        <div className="border-border mt-6 border-t pt-2.5">
          <button
            aria-controls={tableId}
            aria-expanded={showTable}
            className={cn(
              FIGURE_TYPE.table,
              "text-muted-foreground hover:text-foreground -ml-1 inline-flex cursor-pointer items-center gap-1.5 rounded-md border-none bg-transparent px-1 py-0.5 outline-none focus-visible:underline",
            )}
            data-cursor="button"
            onClick={() => setShowTable((value) => !value)}
            type="button"
          >
            <motion.span
              animate={{ rotate: showTable ? 180 : 0 }}
              className="inline-flex"
              initial={false}
              transition={reduceMotion ? { duration: 0 } : spring.moderate}
            >
              <ChevronDown aria-hidden="true" size={15} strokeWidth={1.75} />
            </motion.span>
            {showTable ? "Hide values" : "Show values"}
          </button>
          <AnimatePresence initial={false}>
            {showTable && (
              <motion.div
                animate={{ height: "auto", opacity: 1 }}
                className="overflow-hidden"
                exit={{ height: 0, opacity: 0 }}
                id={tableId}
                initial={{ height: 0, opacity: 0 }}
                transition={reduceMotion ? { duration: 0 } : spring.moderate}
              >
                <DataTable caption={title} columns={columns} note={tableNote} rows={rows} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </figure>
  )
}

export interface LegendEntry {
  readonly color: string
  readonly label: string
  /** Lines key with a stroke, filled marks with a swatch, so the legend mirrors the mark. */
  readonly shape?: "line" | "swatch"
}

/** Present whenever a chart carries two or more series: identity is never colour alone. */
export function ChartLegend({ entries }: { entries: readonly LegendEntry[] }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {entries.map((entry) => (
        <div className="flex items-center gap-2" key={entry.label}>
          <span
            aria-hidden="true"
            className={cn(
              "shrink-0",
              entry.shape === "line" ? "h-0.5 w-3.5 rounded-full" : "size-2.5 rounded-[3px]",
            )}
            style={{ backgroundColor: entry.color }}
          />
          <span className={cn(FIGURE_TYPE.table, "text-muted-foreground")}>{entry.label}</span>
        </div>
      ))}
    </div>
  )
}

export interface TooltipRow {
  readonly color?: string
  readonly label: string
  readonly value: string
}

/** Which diagonal a readout should try first — the quadrant beside the mark that is likely empty. */
export interface TooltipPlacement {
  readonly dx: -1 | 1
  readonly dy: -1 | 1
}

/**
 * The hover readout. Values lead and labels follow — the legend's hierarchy inverted, because the
 * reader already knows which series they pointed at.
 *
 * It sits diagonally off the mark so it does not hide the mark or the stretch of line being
 * followed: the caller names the quadrant its data is not in, and the readout flips to the
 * opposite side only when it would otherwise leave the plot.
 */
export function ChartTooltip({
  heading,
  height,
  placement = { dx: -1, dy: -1 },
  rows,
  width,
  x,
  y,
}: {
  readonly heading: string
  /** Plot height, so the readout can be kept inside it. */
  readonly height: number
  readonly placement?: TooltipPlacement
  readonly rows: readonly TooltipRow[]
  readonly width: number
  readonly x: number
  readonly y: number
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ height: 0, width: 0 })
  const reduceMotion = useChartMotion()

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    setSize({ height: element.offsetHeight, width: element.offsetWidth })
  }, [heading, rows])

  // Try the requested quadrant, flip to the other side of the mark when that would overflow, and
  // clamp only as a last resort so the readout is never clipped by the article column.
  const GAP = 14
  const before = { x: x - GAP - size.width, y: y - GAP - size.height }
  const after = { x: x + GAP, y: y + GAP }
  const wantLeft = placement.dx < 0 ? before.x : after.x
  const wantTop = placement.dy < 0 ? before.y : after.y
  const fitsLeft = wantLeft >= 0 && wantLeft + size.width <= width
  const fitsTop = wantTop >= 0 && wantTop + size.height <= height
  const left = Math.max(
    0,
    Math.min(width - size.width, fitsLeft ? wantLeft : placement.dx < 0 ? after.x : before.x),
  )
  const top = Math.max(
    0,
    Math.min(height - size.height, fitsTop ? wantTop : placement.dy < 0 ? after.y : before.y),
  )

  return (
    <motion.div
      animate={{ opacity: 1, scale: 1 }}
      aria-hidden="true"
      className="bg-surface-4 border-border shadow-surface-4 pointer-events-none absolute z-10 rounded-lg border px-3 py-2.5"
      initial={{ opacity: 0, scale: 0.96 }}
      ref={ref}
      style={{ left, top }}
      transition={reduceMotion ? { duration: 0 } : spring.fast}
    >
      <div className={cn(FIGURE_TYPE.note, "text-muted-foreground whitespace-nowrap")}>
        {heading}
      </div>
      <div className="mt-1.5 grid gap-1.5">
        {rows.map((row) => (
          <div className="flex items-baseline gap-2 whitespace-nowrap" key={row.label}>
            {row.color !== undefined && (
              <span
                className="h-0.5 w-3 shrink-0 self-center rounded-full"
                style={{ backgroundColor: row.color }}
              />
            )}
            {/* The value keeps its weight so it still leads the row; only its size steps down. */}
            <span className={cn(FIGURE_TYPE.label, "text-foreground font-medium tabular-nums")}>
              {row.value}
            </span>
            <span className={cn(FIGURE_TYPE.note, "text-muted-foreground")}>{row.label}</span>
          </div>
        ))}
      </div>
    </motion.div>
  )
}
