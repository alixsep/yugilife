import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { useReducedMotion } from "framer-motion"

import { foregroundForCssColor } from "@/lib/color-contrast"

/**
 * One type scale shared by every figure in an article — charts and hand-built figures alike — so
 * two figures on the same screen are never labelled a step apart.
 *
 * Four sizes only: 18, 16, 14, 12. Roles stay separate where their sizes match, because hierarchy
 * inside a step is carried by weight and colour. Every role but the title resolves through the
 * app's named type roles; the title is the one literal, because the ladder has no 18px entry. The
 * 13px `body` rung is deliberately unused: that is control text, and a figure sitting in 16px prose
 * has no business reaching for it.
 */
export const FIGURE_TYPE = {
  /** The figure's own title. One per figure. */
  title: "text-[18px] leading-[1.35] font-medium tracking-[-0.01em]",
  /** A heading for a section inside a figure built from several of them. */
  heading: "text-title font-medium",
  /** Anything naming what the reader is looking at: a tile, a row, a mark, an axis. */
  label: "text-subtitle",
  /** A value riding a mark, which has to out-weigh the label beside it. */
  value: "text-title font-medium",
  /** The sentence under a title that says what is shown. */
  description: "text-subtitle leading-[1.6]",
  /** The note under the plot, which has to match the article's own figcaption. */
  footnote: "text-subtitle leading-[1.6]",
  /** Rows of values and the controls that switch between them: cells, disclosure, a figure's tabs. */
  table: "text-subtitle",
  /** Axis ticks and band labels, inside SVG. */
  axis: "text-caption",
  /** The quiet second line under a label. */
  note: "text-caption",
} as const

/**
 * The mark colour for a single-series chart. One series has no identity to encode — the mark
 * already carries the value — so it wears the app's accent instead of spending a categorical slot.
 */
export const CHART_ACCENT = "var(--chart-accent)"

/**
 * An ordinal ramp derived from the accent, for part-to-whole marks whose parts are ordered. One hue
 * stepped light to dark reads as one measurement divided up; four unrelated hues do not.
 */
export const CHART_RAMP = [
  "var(--chart-ramp-1)",
  "var(--chart-ramp-2)",
  "var(--chart-ramp-3)",
  "var(--chart-ramp-4)",
] as const

/** Which of the four ramp steps a part at `index` of `length` sits on. */
export function chartRampPosition(index: number, length: number) {
  if (length <= 1) return 0
  // Spread any number of parts across the four steps rather than running off the end of the ramp.
  return Math.min(
    CHART_RAMP.length - 1,
    Math.round((index / (length - 1)) * (CHART_RAMP.length - 1)),
  )
}

export function chartRampStep(index: number, length: number) {
  return CHART_RAMP[chartRampPosition(index, length)] ?? CHART_RAMP[0]
}

/**
 * A readable ink for text sitting on each ramp step, measured rather than assumed:
 * `--user-accent-foreground` is computed against the *page*, so on a dark ramp step it can be the
 * wrong choice entirely. Each step is resolved through a probe element and run through the same
 * contrast helper the accent provider uses. Before the first measurement every step falls back to
 * the accent's own foreground.
 */
export function useRampInks() {
  const [inks, setInks] = useState<readonly string[]>(() =>
    CHART_RAMP.map(() => "var(--user-accent-foreground)"),
  )

  useEffect(() => {
    if (typeof document === "undefined") return
    const probe = document.createElement("span")
    probe.setAttribute("aria-hidden", "true")
    probe.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none"
    document.body.append(probe)

    const measure = () => {
      const backdrop = getComputedStyle(document.body).backgroundColor
      setInks(
        CHART_RAMP.map((token) => {
          probe.style.color = token
          return foregroundForCssColor(getComputedStyle(probe).color, backdrop)
        }),
      )
    }
    measure()

    // The accent provider writes --user-accent onto the root, and the theme toggle swaps a class
    // there; either changes every step underneath us.
    const observer = new MutationObserver(measure)
    observer.observe(document.documentElement, { attributeFilter: ["class", "style"] })
    return () => {
      observer.disconnect()
      probe.remove()
    }
  }, [])

  return inks
}

/**
 * Categorical slot colours, in the fixed order their CSS tokens document. Series are assigned from
 * the front and never cycled: the order is what keeps adjacent pairs separable under colour-vision
 * deficiency, so a ninth series becomes "Other" or a second chart rather than a ninth hue.
 */
export const CHART_SLOTS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
] as const

export function chartSlot(index: number) {
  return CHART_SLOTS[index] ?? CHART_SLOTS[0]
}

/**
 * Measures the element the chart draws into. A viewBox would scale the type with the chart — 11px
 * labels on a phone, 20px on a desktop — so it draws at the measured pixel width instead.
 */
export function useMeasuredWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    setWidth(element.clientWidth)
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}

/**
 * Reveals a chart the first time it scrolls into view, once. Written against
 * `IntersectionObserver` directly rather than a `whileInView` prop so the fallback is explicit:
 * where the observer does not exist, the chart is revealed immediately.
 *
 * This is only half the contract. Every call site must also give each animated property a static
 * value equal to its *final* state, so anything that stops the animation system leaves a finished
 * chart rather than an empty one.
 */
export function useChartReveal<T extends Element>() {
  const ref = useRef<T | null>(null)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element || typeof IntersectionObserver === "undefined") {
      setRevealed(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        setRevealed(true)
        observer.disconnect()
      },
      { threshold: 0.25 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, revealed] as const
}

/**
 * Durations for reveals that are a stroke being drawn rather than a mark settling, which is why
 * these are eased tweens instead of the springs in `@/lib/springs`. Shared so the two charts that
 * draw a path agree, and so a label waiting on a stroke references the stroke's own number.
 */
export const CHART_DRAW = {
  /** A series line across a whole plot. */
  line: { duration: 0.9, ease: "easeInOut" },
  /** The short sparkline inside a stat cell. */
  sparkline: { duration: 0.6, ease: "easeInOut" },
  /** An end marker, which must not appear before the line has reached it. */
  afterLine: { delay: 0.75, duration: 0.3 },
  /** A value label following its own bar in a staggered group. */
  afterBar: { delay: 0.22, duration: 0.25 },
} as const

/** Per-mark delay, so a group of marks arrives as a sweep instead of a single flash. */
export function chartStagger(index: number, reduceMotion: boolean) {
  return reduceMotion ? 0 : index * 0.055
}

export function useChartMotion() {
  return useReducedMotion() === true
}
