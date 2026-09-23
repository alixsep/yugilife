import { useState } from "react"

import { motion } from "framer-motion"

import { spring } from "@/lib/springs"
import { cn } from "@/lib/utils"

import { ChartFrame, ChartQuadrantLayer, ChartTooltip } from "./chart-frame"
import { formatNumber, linearScale, niceTicks } from "./chart-scales"
import {
  CHART_ACCENT,
  chartStagger,
  FIGURE_TYPE,
  useChartMotion,
  useChartReveal,
} from "./chart-tokens"

import type { ChartGoal, ChartQuadrants } from "./chart-frame"
import type { ReactNode } from "react"

export interface ScatterPoint {
  readonly id: string
  readonly label: string
  readonly x: number
  readonly y: number
  /** Direct-labelled in the plot. Label selectively: a name on every dot is unreadable. */
  readonly emphasis?: boolean
}

/**
 * A case that belongs to the experiment but produced no measurement. It cannot be plotted, and
 * dropping it would quietly shrink the experiment to the runs that worked, so the table lists it
 * with the reason in place of its numbers.
 */
export interface ScatterAbsent {
  readonly label: string
  /** What stands in for the measurements, e.g. "fail". */
  readonly note: string
}

export interface ScatterBand {
  /** Inclusive y range the band covers, in data units. */
  readonly from: number
  readonly to: number
  readonly label: string
}

export interface ScatterPlotProps {
  readonly title: string
  readonly description?: ReactNode
  /** Which direction on this chart is the good one. */
  readonly goal?: ChartGoal
  readonly points: readonly ScatterPoint[]
  readonly xLabel: string
  readonly yLabel: string
  readonly formatX?: (value: number) => string
  readonly formatY?: (value: number) => string
  /** Horizontal thresholds drawn behind the marks — verdict bands, budgets, limits. */
  readonly bands?: readonly ScatterBand[]
  /** A vertical budget line, e.g. the size a download has to fit under. */
  readonly xTarget?: { readonly value: number; readonly label: string }
  /** Splits the plot into four and shades the corner a point would have to reach to be a win. */
  readonly quadrants?: ChartQuadrants
  /** Cases with no measurement. They reach the table view only, never the plot. */
  readonly absent?: readonly ScatterAbsent[]
  readonly footnote?: ReactNode
  readonly height?: number
}

// The top inset has to clear the budget-line label, which is drawn above the plot.
const PADDING = { bottom: 46, left: 78, right: 18, top: 30 }
const HIT_RADIUS = 16

/**
 * A scatter plot for a two-measure trade-off. Every mark wears the accent: any two points can end
 * up side by side, a harder colour-separation test than a bar chart, so one cloud takes one colour
 * and direct-labels the points that matter.
 */
export function ScatterPlot({
  absent = [],
  bands = [],
  description,
  footnote,
  goal,
  quadrants,
  formatX = (value) => formatNumber(value),
  formatY = (value) => formatNumber(value),
  height = 330,
  points,
  title,
  xLabel,
  xTarget,
  yLabel,
}: ScatterPlotProps) {
  const [activeId, setActiveId] = useState<string | null>(null)

  return (
    <ChartFrame
      columns={[
        { key: "label", label: "Variant" },
        { key: "x", label: xLabel, numeric: true },
        { key: "y", label: yLabel, numeric: true },
      ]}
      description={description}
      footnote={footnote}
      goal={goal}
      rows={[
        ...points.map((point) => [point.label, formatX(point.x), formatY(point.y)]),
        // The note fills both measure columns: neither was produced, and blanking them would read
        // as zero rather than as nothing.
        ...absent.map((entry) => [entry.label, entry.note, entry.note]),
      ]}
      title={title}
    >
      {(width) => (
        <ScatterCanvas
          activeId={activeId}
          bands={bands}
          formatX={formatX}
          formatY={formatY}
          quadrants={quadrants}
          height={height}
          onActive={setActiveId}
          points={points}
          width={width}
          xLabel={xLabel}
          xTarget={xTarget}
          yLabel={yLabel}
        />
      )}
    </ChartFrame>
  )
}

interface ScatterCanvasProps {
  activeId: string | null
  bands: readonly ScatterBand[]
  formatX: (value: number) => string
  formatY: (value: number) => string
  quadrants?: ChartQuadrants | undefined
  height: number
  onActive: (id: string | null) => void
  points: readonly ScatterPoint[]
  width: number
  xLabel: string
  xTarget?: { readonly value: number; readonly label: string } | undefined
  yLabel: string
}

function ScatterCanvas({
  activeId,
  bands,
  formatX,
  formatY,
  quadrants,
  height,
  onActive,
  points,
  width,
  xLabel,
  xTarget,
  yLabel,
}: ScatterCanvasProps) {
  const reduceMotion = useChartMotion()
  const [revealRef, revealed] = useChartReveal<HTMLDivElement>()
  const plotLeft = PADDING.left
  const plotRight = Math.max(plotLeft + 10, width - PADDING.right)
  const plotBottom = height - PADDING.bottom

  const xValues = points.map((point) => point.x)
  const yValues = points.map((point) => point.y)
  const xDomain = niceTicks(Math.min(...xValues), Math.max(...xValues), 5)
  const yDomain = niceTicks(
    Math.min(...yValues, ...bands.map((band) => band.from)),
    Math.max(...yValues, ...bands.map((band) => band.to)),
    6,
    { zeroBased: true },
  )
  const x = linearScale(xDomain.domain, [plotLeft, plotRight])
  const y = linearScale(yDomain.domain, [plotBottom, PADDING.top])

  // Nearest-point picking: an 8px dot is a pinpoint nobody hits reliably, so the pointer only has
  // to be closest rather than dead centre. `currentTarget` is the <svg>, so no ref is needed.
  function handleMove(event: { clientX: number; clientY: number; currentTarget: SVGSVGElement }) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const pointerX = event.clientX - bounds.left
    const pointerY = event.clientY - bounds.top
    let nearest: ScatterPoint | undefined
    let bestDistance = Infinity
    for (const point of points) {
      const distance = Math.hypot(x(point.x) - pointerX, y(point.y) - pointerY)
      if (distance < bestDistance) {
        bestDistance = distance
        nearest = point
      }
    }
    onActive(nearest && bestDistance <= HIT_RADIUS * 2.5 ? nearest.id : null)
  }

  const active = points.find((point) => point.id === activeId)

  return (
    <div className="relative" ref={revealRef}>
      <svg
        aria-label={`${yLabel} against ${xLabel}`}
        className="block touch-pan-y"
        height={height}
        onPointerLeave={() => onActive(null)}
        onPointerMove={handleMove}
        role="img"
        width={width}
      >
        {quadrants !== undefined && (
          <ChartQuadrantLayer
            hideXSplit={xTarget?.value === quadrants.x}
            plot={{ bottom: plotBottom, left: plotLeft, right: plotRight, top: PADDING.top }}
            quadrants={quadrants}
            scaleX={x}
            scaleY={y}
            xDomain={xDomain.domain}
            yDomain={yDomain.domain}
          />
        )}

        {bands.map((band) => (
          <g key={band.label}>
            {/* Kept faint: a band is the backdrop a reading is judged against, not a mark. */}
            <rect
              fill="var(--chart-grid)"
              opacity={0.55}
              height={Math.abs(y(band.to) - y(band.from))}
              width={plotRight - plotLeft}
              x={plotLeft}
              y={Math.min(y(band.from), y(band.to))}
            />
            {/* Band labels hug the right edge; point labels lean left, so the two never meet. */}
            <text
              className={cn(FIGURE_TYPE.axis, "fill-muted-foreground")}
              dominantBaseline="hanging"
              textAnchor="end"
              x={plotRight - 6}
              y={Math.min(y(band.from), y(band.to)) + 3}
            >
              {band.label}
            </text>
          </g>
        ))}

        {yDomain.ticks.map((tick) => (
          <g key={tick}>
            <line
              stroke="var(--chart-grid)"
              strokeWidth={1}
              x1={plotLeft}
              x2={plotRight}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text
              className={cn(FIGURE_TYPE.axis, "fill-muted-foreground tabular-nums")}
              dominantBaseline="middle"
              textAnchor="end"
              x={plotLeft - 10}
              y={y(tick)}
            >
              {formatY(tick)}
            </text>
          </g>
        ))}
        {xDomain.ticks.map((tick, index) => (
          <text
            className={cn(FIGURE_TYPE.axis, "fill-muted-foreground tabular-nums")}
            key={`x-${tick}`}
            // The end ticks anchor inward so neither runs off the edge of the chart.
            textAnchor={
              index === 0 ? "start" : index === xDomain.ticks.length - 1 ? "end" : "middle"
            }
            x={x(tick)}
            y={height - 24}
          >
            {formatX(tick)}
          </text>
        ))}
        <text
          className={cn(FIGURE_TYPE.label, "fill-muted-foreground")}
          textAnchor="middle"
          x={(plotLeft + plotRight) / 2}
          y={height - 4}
        >
          {xLabel}
        </text>
        {/* Both axes are named: a reader landing on the figure mid-article cannot tell what a bare
            number on an axis measures. */}
        <text
          className={cn(FIGURE_TYPE.label, "fill-muted-foreground")}
          textAnchor="middle"
          transform={`rotate(-90 14 ${(PADDING.top + plotBottom) / 2})`}
          x={14}
          y={(PADDING.top + plotBottom) / 2}
        >
          {yLabel}
        </text>

        {xTarget !== undefined && (
          <g>
            <line
              stroke="var(--chart-muted)"
              strokeDasharray="4 3"
              strokeWidth={1}
              x1={x(xTarget.value)}
              x2={x(xTarget.value)}
              y1={PADDING.top}
              y2={plotBottom}
            />
            <text
              className={cn(FIGURE_TYPE.axis, "fill-muted-foreground")}
              textAnchor="middle"
              x={x(xTarget.value)}
              y={PADDING.top - 10}
            >
              {xTarget.label}
            </text>
          </g>
        )}

        {points.map((point, index) => {
          const isActive = point.id === activeId
          return (
            <g key={point.id}>
              {/* Points arrive one after another, tracing the trade-off in reading order. */}
              <motion.circle
                animate={{
                  opacity:
                    revealed || reduceMotion ? (activeId === null || isActive ? 1 : 0.55) : 0,
                  r: revealed || reduceMotion ? (isActive ? 7 : 5.5) : 0,
                }}
                cx={x(point.x)}
                cy={y(point.y)}
                fill={CHART_ACCENT}
                initial={false}
                // The static radius is the finished one; the animation reaches down to zero and
                // back, so a dot that never animates is still a drawn dot.
                r={isActive ? 7 : 5.5}
                stroke="var(--background)"
                strokeWidth={2}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { ...spring.slow, delay: chartStagger(index, reduceMotion) }
                }
              />
              {point.emphasis && (
                <text
                  className={cn(FIGURE_TYPE.label, "fill-foreground font-medium")}
                  textAnchor={x(point.x) > (plotLeft + plotRight) / 2 ? "end" : "start"}
                  x={x(point.x) + (x(point.x) > (plotLeft + plotRight) / 2 ? -12 : 12)}
                  y={y(point.y) + 5}
                >
                  {point.label}
                </text>
              )}
              <circle
                className="cursor-pointer outline-none"
                cx={x(point.x)}
                cy={y(point.y)}
                fill="transparent"
                onBlur={() => onActive(null)}
                onFocus={() => onActive(point.id)}
                r={HIT_RADIUS}
                tabIndex={0}
              >
                <title>{`${point.label}: ${formatX(point.x)} ${xLabel}, ${formatY(point.y)} ${yLabel}`}</title>
              </circle>
            </g>
          )
        })}
      </svg>
      {active && (
        <ChartTooltip
          height={height}
          heading={active.label}
          rows={[
            { color: CHART_ACCENT, label: xLabel.toLowerCase(), value: formatX(active.x) },
            { label: yLabel.toLowerCase(), value: formatY(active.y) },
          ]}
          width={width}
          x={x(active.x)}
          y={y(active.y) - 6}
        />
      )}
    </div>
  )
}
