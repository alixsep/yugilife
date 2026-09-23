import { useState } from "react"

import { motion } from "framer-motion"

import { spring } from "@/lib/springs"
import { cn } from "@/lib/utils"

import { ChartFrame, ChartLegend, ChartQuadrantLayer, ChartTooltip } from "./chart-frame"
import {
  formatNumber,
  linearScale,
  linePath,
  logMinorTicks,
  logScale,
  logTicks,
  nearestIndex,
  niceTicks,
} from "./chart-scales"
import {
  CHART_ACCENT,
  CHART_DRAW,
  chartSlot,
  FIGURE_TYPE,
  useChartMotion,
  useChartReveal,
} from "./chart-tokens"

import type { TooltipPlacement } from "./chart-frame"
import type { ChartGoal, ChartQuadrants } from "./chart-frame"
import type { ReactNode } from "react"

export type LinePoint = readonly [x: number, y: number]

export interface LineSeries {
  readonly id: string
  readonly label: string
  readonly points: readonly LinePoint[]
}

export interface LineAnnotation {
  readonly x: number
  readonly label: string
  /** A short line under the label, for what the marked position means. */
  readonly detail?: string
}

export interface LineChartProps {
  readonly title: string
  readonly description?: ReactNode
  /** Which direction on this chart is the good one. */
  readonly goal?: ChartGoal
  readonly series: readonly LineSeries[]
  readonly xLabel: string
  readonly yLabel: string
  readonly formatX?: (value: number) => string
  readonly formatY?: (value: number) => string
  /** Marked positions along x — a chosen setting, a threshold, the value that shipped. */
  readonly annotations?: readonly LineAnnotation[]
  /**
   * Positions along the curve labelled with a third variable — usually the setting that produced
   * the point, where both axes are outcomes of it. It cannot have an axis of its own without
   * making this a dual-axis chart.
   */
  readonly waypoints?: readonly { readonly x: number; readonly label: string }[]
  /**
   * Extra rows for the tooltip and table at a given x. A second measure on a different scale
   * belongs here rather than on a second y-axis, which would invite comparing two things that are
   * not comparable.
   */
  readonly secondary?: { readonly label: string; readonly at: (x: number) => string }
  /** Splits the plot into four and shades the corner that would be a win. */
  readonly quadrants?: ChartQuadrants
  /** Base-10 along x, for points that bunch into one end of a linear axis. */
  readonly xScale?: "linear" | "log"
  readonly footnote?: ReactNode
  readonly height?: number
  /**
   * How many rows the table view may show. Past it the table takes an evenly spaced sample and
   * says so; every annotated position is kept, whatever the sampling.
   */
  readonly tableRowLimit?: number
}

// The bottom and left insets carry an axis title under the ticks, so neither is only tick height.
const PADDING = { bottom: 56, left: 52, right: 18, top: 18 }
/**
 * Text inside the plot is drawn with a halo of the page behind it: a label has to sit near the
 * curve it names, and near enough is sometimes on top of it.
 */
const HALO = {
  paintOrder: "stroke",
  stroke: "var(--background)",
  strokeLinejoin: "round",
  strokeWidth: 3.5,
} as const
/** Approximate advance of one 13px tabular digit, for sizing the y-axis gutter to its labels. */
const AXIS_CHAR_WIDTH = 7.4
/** Space the rotated y-axis title takes to the left of its ticks. */
const Y_TITLE_SPACE = 22
/**
 * Clear space a waypoint label needs from its neighbours, the annotations, and the end markers.
 * On a narrow plot waypoints thin out rather than overlap; what is dropped stays in the readout.
 */
const WAYPOINT_MIN_GAP = 34
/** Approximate advance of one character in the waypoint label's type size. */
const WAYPOINT_CHAR_WIDTH = 6.6

function waypointWidth(label: string) {
  return label.length * WAYPOINT_CHAR_WIDTH
}

/**
 * A line chart with a crosshair readout.
 *
 * The y-axis is framed around the data rather than forced to zero. A line carries shape, not
 * magnitude from a baseline, and padding a curve with empty space below it flattens the only thing
 * the reader came for — where it bends. (A bar chart is the opposite case: truncating one lies
 * about the value, so `BarChart` always starts at zero.) There is no area wash underneath for the
 * same reason: a filled region under a floating baseline implies a quantity it is not measuring.
 */
export function LineChart({
  annotations = [],
  description,
  footnote,
  goal,
  formatX = (value) => formatNumber(value),
  formatY = (value) => formatNumber(value),
  height = 320,
  quadrants,
  secondary,
  series,
  tableRowLimit = 16,
  title,
  waypoints = [],
  xLabel,
  xScale = "linear",
  yLabel,
}: LineChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  const xValues = [...new Set(series.flatMap((entry) => entry.points.map(([x]) => x)))].sort(
    (a, b) => a - b,
  )
  const xDomain =
    xScale === "log"
      ? logTicks(Math.min(...xValues), Math.max(...xValues))
      : niceTicks(Math.min(...xValues), Math.max(...xValues), 5)
  const yValues = series.flatMap((entry) => entry.points.map(([, y]) => y))
  // A line is read for its shape, so the axis hugs the data: six steps keep the frame close
  // without the ticks landing on unrecognisable numbers.
  const yDomain = niceTicks(Math.min(...yValues), Math.max(...yValues), 6)
  const tableValues = sampleForTable(xValues, tableRowLimit, [
    ...annotations.map((annotation) => annotation.x),
    ...waypoints.map((waypoint) => waypoint.x),
  ])

  return (
    <ChartFrame
      columns={[
        { key: "x", label: xLabel },
        ...series.map((entry) => ({ key: entry.id, label: entry.label, numeric: true })),
        ...(secondary ? [{ key: "secondary", label: secondary.label, numeric: true }] : []),
      ]}
      description={description}
      footnote={footnote}
      goal={goal}
      rows={tableValues.map((x) => [
        formatX(x),
        ...series.map((entry) => {
          const point = entry.points.find(([pointX]) => pointX === x)
          return point ? formatY(point[1]) : "—"
        }),
        ...(secondary ? [secondary.at(x)] : []),
      ])}
      tableNote={
        tableValues.length < xValues.length
          ? `Sampled: ${tableValues.length} of ${xValues.length} positions, evenly spaced, plus every marked one.`
          : undefined
      }
      title={title}
    >
      {(width) => (
        <LinePlot
          activeIndex={activeIndex}
          annotations={annotations}
          formatX={formatX}
          formatY={formatY}
          height={height}
          onMove={setActiveIndex}
          quadrants={quadrants}
          secondary={secondary}
          series={series}
          waypoints={waypoints}
          width={width}
          xDomain={xDomain.domain}
          xLabel={xLabel}
          xScale={xScale}
          xTicks={xDomain.ticks}
          xValues={xValues}
          yDomain={yDomain.domain}
          yLabel={yLabel}
          yTicks={yDomain.ticks}
        />
      )}
    </ChartFrame>
  )
}

interface LinePlotProps {
  activeIndex: number | null
  annotations: readonly LineAnnotation[]
  formatX: (value: number) => string
  formatY: (value: number) => string
  height: number
  onMove: (index: number | null) => void
  quadrants?: ChartQuadrants | undefined
  secondary?: { readonly label: string; readonly at: (x: number) => string } | undefined
  series: readonly LineSeries[]
  waypoints: readonly { readonly x: number; readonly label: string }[]
  width: number
  xDomain: readonly [number, number]
  xLabel: string
  xScale: "linear" | "log"
  xTicks: readonly number[]
  xValues: readonly number[]
  yDomain: readonly [number, number]
  yLabel: string
  yTicks: readonly number[]
}

function seriesColor(index: number, count: number) {
  return count === 1 ? CHART_ACCENT : chartSlot(index)
}

function LinePlot({
  activeIndex,
  annotations,
  formatX,
  formatY,
  height,
  onMove,
  quadrants,
  secondary,
  series,
  waypoints,
  width,
  xDomain,
  xLabel,
  xScale,
  xTicks,
  xValues,
  yDomain,
  yLabel,
  yTicks,
}: LinePlotProps) {
  const reduceMotion = useChartMotion()
  const [revealRef, revealed] = useChartReveal<HTMLDivElement>()
  // The gutter is sized to the widest tick it has to hold. A fixed inset clips a label the moment
  // the formatter gains a decimal place, and the axis is the one thing that must always be legible.
  const widestTick = Math.max(...yTicks.map((tick) => formatY(tick).length))
  const plotLeft =
    Math.max(PADDING.left, Math.ceil(widestTick * AXIS_CHAR_WIDTH) + 14) + Y_TITLE_SPACE
  const plotRight = Math.max(plotLeft + 10, width - PADDING.right)
  const plotBottom = height - PADDING.bottom
  const x =
    xScale === "log"
      ? logScale(xDomain, [plotLeft, plotRight])
      : linearScale(xDomain, [plotLeft, plotRight])
  const y = linearScale(yDomain, [plotBottom, PADDING.top])
  const activeX = activeIndex === null ? undefined : xValues[activeIndex]
  const primary = series[0]

  // `currentTarget` is the <svg> itself, so the plot needs no ref of its own to convert a client
  // position into plot coordinates.
  function handleMove(event: { clientX: number; currentTarget: SVGSVGElement }) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const pointerX = event.clientX - bounds.left
    if (pointerX < plotLeft - 8 || pointerX > plotRight + 8) return onMove(null)
    onMove(nearestIndex(xValues, x.invert(pointerX)))
  }

  return (
    <div className="relative" ref={revealRef}>
      <svg
        aria-label={`${yLabel} from ${formatX(xDomain[0])} to ${formatX(xDomain[1])}`}
        // Focusable for the arrow-key readout. The browser default box appears on a plain click
        // too, so this shows a ring only for keyboard focus.
        className="block touch-pan-y rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-(--focus-ring)"
        height={height}
        onBlur={() => onMove(null)}
        onFocus={() => onMove(xValues.length - 1)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
          event.preventDefault()
          const next = (activeIndex ?? xValues.length - 1) + (event.key === "ArrowRight" ? 1 : -1)
          onMove(Math.max(0, Math.min(xValues.length - 1, next)))
        }}
        onPointerLeave={() => onMove(null)}
        onPointerMove={handleMove}
        role="img"
        tabIndex={0}
        width={width}
      >
        {/* Under the gridlines and the curve. The vertical split is dropped when an annotation
            already stands there, to avoid doubling it. */}
        {quadrants !== undefined && (
          <ChartQuadrantLayer
            hideXSplit={annotations.some((annotation) => annotation.x === quadrants.x)}
            plot={{ bottom: plotBottom, left: plotLeft, right: plotRight, top: PADDING.top }}
            quadrants={quadrants}
            scaleX={x}
            scaleY={y}
            xDomain={xDomain}
            yDomain={yDomain}
          />
        )}

        {/* Only a log axis gets vertical rules, and only very faint ones. Their uneven spacing is
            the point: it shows the axis compressing, which a linear axis has no need to say. */}
        {xScale === "log" &&
          logMinorTicks(xDomain[0], xDomain[1]).map((tick) => (
            <line
              key={`minor-${tick}`}
              opacity={0.45}
              stroke="var(--chart-grid)"
              strokeWidth={1}
              x1={x(tick)}
              x2={x(tick)}
              y1={PADDING.top}
              y2={plotBottom}
            />
          ))}

        {yTicks.map((tick) => (
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
        {xTicks.map((tick, index) => (
          <text
            className={cn(FIGURE_TYPE.axis, "fill-muted-foreground tabular-nums")}
            key={`x-${tick}`}
            // The end ticks anchor inward so neither runs off the edge of the chart.
            textAnchor={index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle"}
            x={x(tick)}
            y={height - 32}
          >
            {formatX(tick)}
          </text>
        ))}

        {/* Both axes are named on the plot: the title above says what the chart is about, not what
            its axes measure. */}
        <text
          className={cn(FIGURE_TYPE.label, "fill-muted-foreground")}
          textAnchor="middle"
          x={(plotLeft + plotRight) / 2}
          y={height - 8}
        >
          {xLabel}
        </text>
        <text
          className={cn(FIGURE_TYPE.label, "fill-muted-foreground")}
          textAnchor="middle"
          transform={`rotate(-90 14 ${(PADDING.top + plotBottom) / 2})`}
          x={14}
          y={(PADDING.top + plotBottom) / 2}
        >
          {yLabel}
        </text>

        {series.map((entry, index) => (
          <motion.path
            animate={{ pathLength: revealed || reduceMotion ? 1 : 0 }}
            d={linePath(entry.points.map(([px, py]) => [x(px), y(py)] as const))}
            fill="none"
            initial={false}
            key={entry.id}
            stroke={seriesColor(index, series.length)}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.5}
            transition={reduceMotion ? { duration: 0 } : CHART_DRAW.line}
          />
        ))}

        {/* The third variable, written along the curve it produced. */}
        {primary &&
          thinWaypoints(waypoints, (value) => x(value), [
            ...annotations.map((annotation) => annotation.x),
            ...[primary.points.at(0), primary.points.at(-1)].map((point) => point?.[0] ?? NaN),
          ]).map((waypoint) => {
            const point = primary.points.find(([px]) => px === waypoint.x)
            if (!point) return null
            const px = x(waypoint.x)
            const py = y(point[1])
            // Where the curve is steeper than 45° the space above a point is occupied by the curve
            // itself, so the label steps aside instead of sitting on the line.
            const index = primary.points.indexOf(point)
            const neighbour = primary.points[index + 1] ?? primary.points[index - 1]
            const steep =
              neighbour !== undefined &&
              Math.abs(y(neighbour[1]) - py) > Math.abs(x(neighbour[0]) - px)
            const placement = waypointLabel(waypoint.label, px, steep, plotLeft, plotRight)
            return (
              <g key={waypoint.label}>
                <circle
                  cx={px}
                  cy={py}
                  fill={seriesColor(0, series.length)}
                  r={3.5}
                  stroke="var(--background)"
                  strokeWidth={2}
                />
                <text
                  className={cn(FIGURE_TYPE.axis, "fill-muted-foreground")}
                  {...HALO}
                  textAnchor={placement.anchor}
                  x={placement.x}
                  // Otherwise above the point, unless that would push the label into the band the
                  // annotation labels occupy.
                  y={steep ? py + 4 : py > PADDING.top + 26 ? py - 12 : py + 20}
                >
                  {waypoint.label}
                </text>
              </g>
            )
          })}

        {primary &&
          annotations.map((annotation) => {
            const point = primary.points.find(([px]) => px === annotation.x)
            if (!point) return null
            const px = x(annotation.x)
            const py = y(point[1])
            // The label block is placed on whichever side of its rule actually has room for it,
            // and kept inside the plot. Choosing by which half of the chart the rule is in says
            // nothing about whether the text fits, which is how it ends up against the y-axis.
            const estimate = Math.max(
              annotation.label.length * 8.2,
              (annotation.detail?.length ?? 0) * 7.6,
            )
            const roomLeft = px - 12 - (plotLeft + 8)
            const roomRight = plotRight - 8 - (px + 12)
            // The block sits above its mark, so it belongs on whichever side the curve is falling
            // away from; the other side is the one the curve came from and is already occupied.
            const ordered = [...primary.points].sort((a, b) => a[0] - b[0])
            const at = ordered.findIndex(([pointX]) => pointX === annotation.x)
            const before = ordered[at - 1]
            const after = ordered[at + 1]
            const preferRight =
              before !== undefined && after !== undefined
                ? y(after[1]) > y(before[1])
                : after !== undefined
            const toLeft = preferRight ? estimate > roomRight : estimate <= roomLeft
            const anchor = toLeft ? "end" : "start"
            const labelX = toLeft
              ? Math.max(px - 12, plotLeft + 8 + estimate)
              : Math.min(px + 12, plotRight - 8 - estimate)
            // The block sits above its own mark with a short stem down to it, rather than at the
            // top of the plot. Parked up there it needed a rule the height of the chart to say
            // which point it meant, and a rule that long divides the figure in two.
            const detailY = py - 14
            const labelY = detailY - (annotation.detail === undefined ? 0 : 16)
            const stemTop = detailY + 5
            return (
              <g key={annotation.label}>
                {/* A stem, not a divider: from just under the label down to the mark it names. */}
                {py - 9 > stemTop && (
                  <line
                    stroke="var(--chart-muted)"
                    strokeWidth={1}
                    x1={px}
                    x2={px}
                    y1={stemTop}
                    y2={py - 9}
                  />
                )}
                <motion.circle
                  animate={{ opacity: revealed || reduceMotion ? 1 : 0 }}
                  cx={px}
                  cy={py}
                  fill={seriesColor(0, series.length)}
                  initial={false}
                  r={5}
                  stroke="var(--background)"
                  strokeWidth={2.5}
                  transition={reduceMotion ? { duration: 0 } : CHART_DRAW.afterLine}
                />
                <text
                  className={cn(FIGURE_TYPE.label, "fill-foreground font-medium")}
                  {...HALO}
                  textAnchor={anchor}
                  x={labelX}
                  y={labelY}
                >
                  {annotation.label}
                </text>
                {annotation.detail !== undefined && (
                  <text
                    className={cn(FIGURE_TYPE.axis, "fill-muted-foreground")}
                    {...HALO}
                    textAnchor={anchor}
                    x={labelX}
                    y={detailY}
                  >
                    {annotation.detail}
                  </text>
                )}
              </g>
            )
          })}

        {/* End markers carry the values the axis rounds away. Found by x rather than by position
            in the array: a series recorded from its far end backwards is still a series, and
            trusting the order puts both labels outside the plot on opposite sides. */}
        {primary &&
          [
            primary.points.reduce((low, point) => (point[0] < low[0] ? point : low)),
            primary.points.reduce((high, point) => (point[0] > high[0] ? point : high)),
          ].map((point, index) => {
            if (!point) return null
            const px = x(point[0])
            const py = y(point[1])
            // A point near the ceiling would put its label in the band the annotation labels use,
            // so it flips underneath instead of stacking two unrelated labels on one line.
            const labelAbove = py > PADDING.top + 24
            return (
              <g key={index === 0 ? "start" : "end"}>
                <circle
                  cx={px}
                  cy={py}
                  fill={seriesColor(0, series.length)}
                  r={4}
                  stroke="var(--background)"
                  strokeWidth={2.5}
                />
                <text
                  className={cn(FIGURE_TYPE.label, "fill-foreground tabular-nums")}
                  {...HALO}
                  dominantBaseline="middle"
                  textAnchor={index === 0 ? "start" : "end"}
                  x={px + (index === 0 ? 10 : -10)}
                  y={py + (labelAbove ? -16 : 18)}
                >
                  {formatY(point[1])}
                </text>
              </g>
            )
          })}

        {activeX !== undefined && (
          <g>
            <line
              stroke="var(--chart-muted)"
              strokeWidth={1}
              x1={x(activeX)}
              x2={x(activeX)}
              y1={PADDING.top}
              y2={plotBottom}
            />
            {series.map((entry, index) => {
              const point = entry.points.find(([px]) => px === activeX)
              if (!point) return null
              return (
                <motion.circle
                  animate={{ cx: x(point[0]), cy: y(point[1]) }}
                  cx={x(point[0])}
                  cy={y(point[1])}
                  fill={seriesColor(index, series.length)}
                  initial={false}
                  key={entry.id}
                  r={5}
                  stroke="var(--background)"
                  strokeWidth={2.5}
                  transition={reduceMotion ? { duration: 0 } : spring.fast}
                />
              )
            })}
          </g>
        )}
      </svg>
      {activeX !== undefined && (
        <ChartTooltip
          // The axis title carries the unit for the axis; the value carries its own. Printing both
          // in the heading reads as a stutter ("Smaller than PNG (%) 88%"), so the parenthetical
          // is dropped here and nowhere else.
          heading={`${xLabel.replace(/\s*\([^)]*\)\s*$/, "")} ${formatX(activeX)}`}
          rows={[
            ...series.flatMap((entry, index) => {
              const point = entry.points.find(([px]) => px === activeX)
              return point
                ? [
                    {
                      color: seriesColor(index, series.length),
                      label: entry.label.toLowerCase(),
                      value: formatY(point[1]),
                    },
                  ]
                : []
            }),
            ...(secondary
              ? [{ label: secondary.label.toLowerCase(), value: secondary.at(activeX) }]
              : []),
          ]}
          height={height}
          placement={tooltipPlacement(primary?.points, activeX, x, y)}
          width={width}
          x={x(activeX)}
          y={Math.min(
            ...series.map((entry) => {
              const point = entry.points.find(([px]) => px === activeX)
              return point ? y(point[1]) : plotBottom
            }),
          )}
        />
      )}
      {series.length > 1 && (
        <ChartLegend
          entries={series.map((entry, index) => ({
            color: seriesColor(index, series.length),
            label: entry.label,
            shape: "line" as const,
          }))}
        />
      )}
    </div>
  )
}

/**
 * The quadrant beside the mark that the curve is not running through.
 *
 * A curve climbing to the right leaves its upper left empty; one falling to the right leaves its
 * upper right empty. Putting the readout there means it never lands on the line the reader is
 * tracing, which a centred readout does constantly on a steep section.
 */
function tooltipPlacement(
  points: readonly LinePoint[] | undefined,
  activeX: number,
  x: (value: number) => number,
  y: (value: number) => number,
): TooltipPlacement {
  const index = points?.findIndex(([px]) => px === activeX) ?? -1
  const current = points?.[index]
  const neighbour = points?.[index + 1] ?? points?.[index - 1]
  if (!current || !neighbour) return { dx: -1, dy: -1 }
  const run = x(neighbour[0]) - x(current[0])
  if (run === 0) return { dx: -1, dy: -1 }
  const rising = (y(neighbour[1]) - y(current[1])) / run < 0
  return { dx: rising ? -1 : 1, dy: -1 }
}

/**
 * Drops waypoint labels that would crowd another label, in the order they were given.
 *
 * Obstacles are the positions that already carry a label of their own — the annotations and the
 * two end markers — because those say something the waypoints do not.
 */
function thinWaypoints(
  waypoints: readonly { readonly x: number; readonly label: string }[],
  toPixels: (value: number) => number,
  obstacles: readonly number[],
) {
  const taken = obstacles.filter((value) => Number.isFinite(value)).map(toPixels)
  const kept: { readonly x: number; readonly label: string }[] = []
  for (const waypoint of waypoints) {
    const px = toPixels(waypoint.x)
    // A long label needs more room than a short one; the fixed gap is only the floor.
    const clearance = Math.max(WAYPOINT_MIN_GAP, waypointWidth(waypoint.label) * 0.6 + 12)
    if (taken.some((other) => Math.abs(other - px) < clearance)) continue
    taken.push(px)
    kept.push(waypoint)
  }
  return kept
}

/**
 * Keeps a waypoint label inside the plot.
 *
 * A steep point puts its label beside itself rather than on the curve, which near an edge is the
 * one direction with no room; it flips to the other side instead of hanging over the axis. A label
 * sitting above its point is centred, so it only needs nudging in from either end.
 */
function waypointLabel(
  label: string,
  px: number,
  steep: boolean,
  plotLeft: number,
  plotRight: number,
) {
  const width = waypointWidth(label)
  if (steep) {
    return px - 10 - width >= plotLeft + 4
      ? ({ anchor: "end", x: px - 10 } as const)
      : ({ anchor: "start", x: px + 10 } as const)
  }
  const half = width / 2
  return {
    anchor: "middle",
    x: Math.min(Math.max(px, plotLeft + 4 + half), plotRight - 4 - half),
  } as const
}

/**
 * An evenly spaced sample of `values`, always including the ends and any position that carries an
 * annotation, capped at `limit` rows.
 */
function sampleForTable(
  values: readonly number[],
  limit: number,
  keep: readonly number[],
): readonly number[] {
  if (values.length <= limit) return values
  const chosen = new Set<number>(keep.filter((value) => values.includes(value)))
  const stride = (values.length - 1) / Math.max(1, limit - chosen.size - 1)
  for (let index = 0; index < values.length; index += stride) {
    const value = values[Math.round(index)]
    if (value !== undefined) chosen.add(value)
  }
  const last = values.at(-1)
  if (last !== undefined) chosen.add(last)
  return [...chosen].sort((a, b) => a - b)
}
