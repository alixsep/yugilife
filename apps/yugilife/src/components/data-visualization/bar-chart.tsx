import { useId, useState } from "react"

import { motion } from "framer-motion"

import { spring } from "@/lib/springs"
import { cn } from "@/lib/utils"

import { ChartFrame } from "./chart-frame"
import { barPath, formatNumber, linearScale, niceTicks } from "./chart-scales"
import {
  CHART_ACCENT,
  chartStagger,
  FIGURE_TYPE,
  useChartMotion,
  useChartReveal,
} from "./chart-tokens"

import type { ChartGoal } from "./chart-frame"
import type { ReactNode } from "react"

export interface BarDatum {
  readonly label: string
  readonly value: number
  /**
   * Marks the bar the figure is about. When any bar sets it, the rest drop to the de-emphasis
   * fill — the honest form when one value is the story and the others are context.
   */
  readonly emphasis?: boolean
  /** Optional second line under the label, for units or conditions. */
  readonly note?: string
}

export interface BarChartProps {
  readonly title: string
  readonly description?: ReactNode
  /** Which direction on this chart is the good one. */
  readonly goal?: ChartGoal
  /** Keep labels short: above about 460px of width they share a line with the bar. */
  readonly data: readonly BarDatum[]
  /** Unit for the table header and the accessible description, e.g. "ms". */
  readonly unit?: string
  readonly format?: (value: number) => string
  readonly footnote?: ReactNode
  readonly categoryLabel?: string
  readonly valueLabel?: string
}

const BAR_THICKNESS = 20
const AXIS_HEIGHT = 28
/** Gap between the label column and the start of the plot. */
const LABEL_GAP = 14
/** Gap between a bar's tip and the value riding it. */
const VALUE_GAP = 10
/** Rough advance width of the value type (15px, medium, tabular). Used to reserve the tip gutter. */
const VALUE_CHAR_WIDTH = 9.2
/**
 * Below this width the label moves onto its own line above a full-width bar. A side label gets
 * about a third of the chart and SVG text cannot ellipsize, so a long one would be drawn straight
 * across the plot.
 */
const STACK_BELOW = 460

/**
 * Horizontal bars for comparing magnitude across named categories. Every bar shares the accent —
 * length already encodes the value, so per-bar colour would re-encode what is already visible.
 * Set `emphasis` when one bar is the story and the rest are context.
 */
export function BarChart({
  categoryLabel = "Category",
  data,
  description,
  footnote,
  goal,
  format = (value) => formatNumber(value),
  title,
  unit,
  valueLabel = "Value",
}: BarChartProps) {
  const [hovered, setHovered] = useState<number | null>(null)
  const reduceMotion = useChartMotion()
  const clipId = useId().replaceAll(":", "")
  const [revealRef, revealed] = useChartReveal<HTMLDivElement>()
  const hasEmphasis = data.some((datum) => datum.emphasis)

  return (
    <ChartFrame
      // No table view: every bar carries its own value beside it, and each row's label and note
      // are already written out. The disclosure would open onto the numbers on screen.
      tableView={false}
      columns={[
        { key: "label", label: categoryLabel },
        {
          key: "value",
          label: unit === undefined ? valueLabel : `${valueLabel} (${unit})`,
          numeric: true,
        },
      ]}
      description={description}
      footnote={footnote}
      goal={goal}
      rows={data.map((datum) => [
        datum.note === undefined ? datum.label : `${datum.label} — ${datum.note}`,
        format(datum.value),
      ])}
      title={title}
    >
      {(width) => {
        const stacked = width < STACK_BELOW
        const rowHeight = stacked ? 62 : 46
        const max = Math.max(...data.map((datum) => datum.value), 0)
        const { domain, ticks } = niceTicks(0, max, 4, { zeroBased: true })
        const widestValue = Math.max(...data.map((datum) => format(datum.value).length))
        // The value rides its bar's tip, so the only space reserved on the right is the room that
        // one label needs — not a detached column the whole chart has to reach across.
        const valueGutter = stacked ? 0 : Math.ceil(widestValue * VALUE_CHAR_WIDTH) + VALUE_GAP + 4
        const plotLeft = stacked ? 0 : Math.round(Math.min(width * 0.32, 200)) + LABEL_GAP
        const plotRight = stacked ? width : Math.max(plotLeft + 24, width - valueGutter)
        const plotHeight = data.length * rowHeight
        const x = linearScale(domain, [plotLeft, plotRight])
        // Stacked, the bar sits under its own label; side by side it is centred in the row.
        const barOffset = stacked ? rowHeight - BAR_THICKNESS - 8 : (rowHeight - BAR_THICKNESS) / 2

        return (
          <div className="relative" ref={revealRef}>
            <svg
              aria-label={`${valueLabel}${unit === undefined ? "" : ` in ${unit}`} by ${categoryLabel.toLowerCase()}`}
              className="block"
              height={plotHeight + AXIS_HEIGHT}
              onPointerLeave={() => setHovered(null)}
              role="img"
              width={width}
            >
              {ticks.map((tick) => (
                <line
                  key={tick}
                  stroke="var(--chart-grid)"
                  strokeWidth={1}
                  x1={x(tick)}
                  x2={x(tick)}
                  y1={0}
                  y2={plotHeight}
                />
              ))}
              {ticks.map((tick, index) => (
                <text
                  className={cn(FIGURE_TYPE.axis, "fill-muted-foreground tabular-nums")}
                  key={`tick-${tick}`}
                  // The end ticks anchor inward so neither runs off the edge of the chart.
                  textAnchor={index === 0 ? "start" : index === ticks.length - 1 ? "end" : "middle"}
                  x={x(tick)}
                  y={plotHeight + 18}
                >
                  {format(tick)}
                </text>
              ))}

              {data.map((datum, index) => {
                const y = index * rowHeight
                const barWidth = Math.max(0, x(datum.value) - plotLeft)
                const fill = hasEmphasis && !datum.emphasis ? "var(--chart-muted)" : CHART_ACCENT
                const isHovered = hovered === index
                const labelY = stacked
                  ? y + 14
                  : datum.note === undefined
                    ? y + rowHeight / 2
                    : y + rowHeight / 2 - 8

                return (
                  // Hover dims the other rows rather than painting a full-width band, which
                  // would box in the labels and say nothing about the mark being pointed at.
                  <motion.g
                    animate={{ opacity: hovered !== null && !isHovered ? 0.45 : 1 }}
                    className="outline-none"
                    initial={false}
                    key={datum.label}
                    onBlur={() => setHovered(null)}
                    onFocus={() => setHovered(index)}
                    onPointerMove={() => setHovered(index)}
                    tabIndex={0}
                    transition={reduceMotion ? { duration: 0 } : spring.fast}
                  >
                    {/* The hit area is the whole row, so the pointer never has to find a 20px band. */}
                    <rect fill="transparent" height={rowHeight} width={width} x={0} y={y} />
                    <text
                      className={cn(FIGURE_TYPE.label, "fill-foreground")}
                      dominantBaseline="middle"
                      x={0}
                      y={labelY}
                    >
                      {datum.label}
                    </text>
                    {datum.note !== undefined && !stacked && (
                      <text
                        className={cn(FIGURE_TYPE.axis, "fill-muted-foreground")}
                        dominantBaseline="middle"
                        x={0}
                        y={y + rowHeight / 2 + 9}
                      >
                        {datum.note}
                      </text>
                    )}
                    <clipPath id={`${clipId}-${index}`}>
                      <motion.rect
                        animate={{ width: revealed || reduceMotion ? barWidth : 0 }}
                        height={BAR_THICKNESS}
                        initial={false}
                        transition={
                          reduceMotion
                            ? { duration: 0 }
                            : { ...spring.slow, delay: chartStagger(index, reduceMotion) }
                        }
                        // Static width is the finished bar; the animation reaches down to zero.
                        width={barWidth}
                        x={plotLeft}
                        y={y + barOffset}
                      />
                    </clipPath>
                    <path
                      clipPath={`url(#${clipId}-${index})`}
                      d={barPath(plotLeft, y + barOffset, barWidth, BAR_THICKNESS, 4, "right")}
                      fill={fill}
                    />
                    {/* The value travels with its bar. A fixed column on the far right leaves a
                        void the eye has to cross to connect a length to a number. */}
                    <text
                      className={cn(FIGURE_TYPE.value, "fill-foreground tabular-nums")}
                      dominantBaseline="middle"
                      textAnchor={stacked ? "end" : "start"}
                      x={stacked ? width : plotLeft + barWidth + VALUE_GAP}
                      y={stacked ? labelY : y + rowHeight / 2}
                    >
                      {format(datum.value)}
                    </text>
                  </motion.g>
                )
              })}
            </svg>
          </div>
        )
      }}
    </ChartFrame>
  )
}
