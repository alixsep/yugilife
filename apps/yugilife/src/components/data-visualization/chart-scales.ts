/**
 * Pure geometry and formatting for the chart components.
 *
 * None of this touches React or the DOM, which is what makes the parts that are easy to get
 * subtly wrong — tick selection, domain padding, path construction — directly testable.
 */

export interface LinearScale {
  /** Maps a data value to a pixel position along the axis. */
  (value: number): number
  readonly domain: readonly [number, number]
  readonly range: readonly [number, number]
  /** Maps a pixel position back to a data value. */
  readonly invert: (position: number) => number
}

export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): LinearScale {
  const [d0, d1] = domain
  const [r0, r1] = range
  // A zero-width domain would divide by zero; pin it to the middle of the range instead, which is
  // where a single repeated value belongs.
  const span = d1 - d0
  const scale = ((value: number) =>
    span === 0 ? (r0 + r1) / 2 : r0 + ((value - d0) / span) * (r1 - r0)) as {
    (value: number): number
    domain: readonly [number, number]
    range: readonly [number, number]
    invert: (position: number) => number
  }
  scale.domain = domain
  scale.range = range
  scale.invert = (position: number) => (r1 === r0 ? d0 : d0 + ((position - r0) / (r1 - r0)) * span)
  return scale
}

/**
 * The next round number at or above `value`, from the 1 / 2 / 2.5 / 5 / 10 family, so ticks land
 * on numbers a reader recognises rather than on 1,607.
 */
export function niceNumber(value: number, round: boolean) {
  if (value === 0) return 0
  const exponent = Math.floor(Math.log10(Math.abs(value)))
  const fraction = Math.abs(value) / 10 ** exponent
  let niceFraction: number
  if (round) {
    if (fraction < 1.5) niceFraction = 1
    else if (fraction < 3) niceFraction = 2
    else if (fraction < 7) niceFraction = 5
    else niceFraction = 10
  } else {
    if (fraction <= 1) niceFraction = 1
    else if (fraction <= 2) niceFraction = 2
    else if (fraction <= 2.5) niceFraction = 2.5
    else if (fraction <= 5) niceFraction = 5
    else niceFraction = 10
  }
  return Math.sign(value) * niceFraction * 10 ** exponent
}

export interface TickedDomain {
  domain: readonly [number, number]
  ticks: readonly number[]
}

/**
 * Rounds a domain outward to clean bounds and returns the ticks inside it.
 *
 * `count` is a target, not a promise: the rounding decides the real spacing, so asking for five
 * ticks over 0–101 gives six at 0/20/40/60/80/100 rather than five at 20.2.
 */
/**
 * A base-10 scale, for a measure whose interesting range spans more than its absolute size — file
 * size against quality, where a linear axis squashes nearly every setting into its last few
 * percent. On a log axis equal ratios take equal space, which is what is being compared.
 */
export function logScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): LinearScale {
  const safe = (value: number) => Math.log10(Math.max(value, 1e-9))
  const [d0, d1] = domain
  const inner = linearScale([safe(d0), safe(d1)], range)
  const scale = ((value: number) => inner(safe(value))) as {
    (value: number): number
    domain: readonly [number, number]
    range: readonly [number, number]
    invert: (position: number) => number
  }
  scale.domain = domain
  scale.range = range
  scale.invert = (position: number) => 10 ** inner.invert(position)
  return scale
}

/**
 * Ticks at 1, 2 and 5 in every decade the data crosses. The domain follows the data with a margin
 * rather than rounding out to the next power of ten, which would spend a third of the axis on
 * emptiness.
 */
export function logTicks(min: number, max: number): TickedDomain {
  if (!(min > 0) || !(max > min) || !Number.isFinite(max))
    return { domain: [1, 10], ticks: [1, 10] }
  // A domain ending exactly on the outermost points pins them to the frame, where their markers
  // are half-clipped and their labels have nowhere to go but inward over the plot.
  const pad = (Math.log10(max) - Math.log10(min)) * 0.055
  const domain = [10 ** (Math.log10(min) - pad), 10 ** (Math.log10(max) + pad)] as const
  const candidates: number[] = []
  for (
    let exponent = Math.floor(Math.log10(domain[0]));
    exponent <= Math.ceil(Math.log10(domain[1]));
    exponent += 1
  ) {
    for (const step of [1, 2, 5]) candidates.push(step * 10 ** exponent)
  }
  return {
    domain,
    ticks: candidates.filter((tick) => tick > domain[0] && tick < domain[1]),
  }
}

/**
 * Every 1..9 step inside each decade the data crosses, for gridlines rather than labels. Drawn
 * faintly, their crowding towards the top of each decade is what shows the axis compressing.
 */
export function logMinorTicks(min: number, max: number): readonly number[] {
  if (!(min > 0) || !(max > min) || !Number.isFinite(max)) return []
  const ticks: number[] = []
  for (
    let exponent = Math.floor(Math.log10(min));
    exponent <= Math.ceil(Math.log10(max));
    exponent += 1
  ) {
    for (let step = 1; step <= 9; step += 1) {
      const tick = step * 10 ** exponent
      if (tick > min && tick < max) ticks.push(tick)
    }
  }
  return ticks
}

export function niceTicks(
  min: number,
  max: number,
  count = 5,
  options: { zeroBased?: boolean } = {},
): TickedDomain {
  const low = options.zeroBased ? Math.min(0, min) : min
  if (!Number.isFinite(low) || !Number.isFinite(max)) return { domain: [0, 1], ticks: [0, 1] }
  if (low === max) {
    const pad = Math.abs(low) || 1
    return { domain: [low - pad, max + pad], ticks: [low - pad, low, max + pad] }
  }

  const step = niceNumber(niceNumber(max - low, false) / Math.max(1, count - 1), true)
  const start = Math.floor(low / step) * step
  const end = Math.ceil(max / step) * step
  const ticks: number[] = []
  // Accumulating with multiplication rather than repeated addition keeps float drift from turning
  // a tick that should read "0.3" into "0.30000000000000004".
  const steps = Math.round((end - start) / step)
  for (let index = 0; index <= steps; index += 1) {
    ticks.push(Number((start + index * step).toPrecision(12)))
  }
  return { domain: [start, end], ticks }
}

/** An SVG path through the points, in order. Points are already in pixel space. */
export function linePath(points: readonly (readonly [number, number])[]) {
  if (points.length === 0) return ""
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${round(x)} ${round(y)}`).join("")
}

/** The same path closed down to `baseline`, for an area wash under a line. */
export function areaPath(points: readonly (readonly [number, number])[], baseline: number) {
  const first = points.at(0)
  const last = points.at(-1)
  if (!first || !last) return ""
  return `${linePath(points)}L${round(last[0])} ${round(baseline)}L${round(first[0])} ${round(baseline)}Z`
}

/**
 * A rectangle rounded on one end only: bars round at the data-end and stay square on the baseline,
 * so they read as leaving the axis rather than floating free of it.
 */
export function barPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  end: "top" | "right",
) {
  const w = Math.max(0, width)
  const h = Math.max(0, height)
  // Never round more than half the short side, or the corners meet and invert.
  const r = Math.max(0, Math.min(radius, end === "top" ? Math.min(w / 2, h) : Math.min(h / 2, w)))
  if (r === 0) return `M${round(x)} ${round(y)}h${round(w)}v${round(h)}h${round(-w)}Z`
  if (end === "right") {
    return (
      `M${round(x)} ${round(y)}` +
      `h${round(w - r)}a${round(r)} ${round(r)} 0 0 1 ${round(r)} ${round(r)}` +
      `v${round(h - r * 2)}a${round(r)} ${round(r)} 0 0 1 ${round(-r)} ${round(r)}` +
      `h${round(-(w - r))}Z`
    )
  }
  return (
    `M${round(x)} ${round(y + r)}` +
    `a${round(r)} ${round(r)} 0 0 1 ${round(r)} ${round(-r)}` +
    `h${round(w - r * 2)}a${round(r)} ${round(r)} 0 0 1 ${round(r)} ${round(r)}` +
    `v${round(h - r)}h${round(-w)}Z`
  )
}

function round(value: number) {
  return Number(value.toFixed(2))
}

/** Index of the point whose x is closest to `value`. Assumes ascending x. */
export function nearestIndex(values: readonly number[], value: number) {
  if (values.length === 0) return -1
  let best = 0
  let bestDistance = Infinity
  for (let index = 0; index < values.length; index += 1) {
    const distance = Math.abs((values[index] ?? 0) - value)
    if (distance < bestDistance) {
      bestDistance = distance
      best = index
    }
  }
  return best
}

/**
 * Compact notation for large values: 12.9K, 4.2M. For stat tiles and axis ticks, where magnitude
 * matters more than digits; exact values stay available in the table view.
 */
export function compactNumber(value: number) {
  const magnitude = Math.abs(value)
  if (magnitude >= 1_000_000_000) return `${trim(value / 1_000_000_000)}B`
  if (magnitude >= 1_000_000) return `${trim(value / 1_000_000)}M`
  if (magnitude >= 10_000) return `${trim(value / 1_000)}K`
  return formatNumber(value)
}

/** Thousands-separated, with at most `fractionDigits` decimals and no trailing zeros. */
export function formatNumber(value: number, fractionDigits = 2) {
  return value.toLocaleString("en-US", { maximumFractionDigits: fractionDigits })
}

function trim(value: number) {
  return Number(value.toFixed(1)).toLocaleString("en-US")
}
