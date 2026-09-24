import { useEffect, useRef } from "react"

import { useReducedMotion } from "framer-motion"

const formatter = new Intl.NumberFormat("en-US")
const durationMs = 1400

/**
 * A figure that counts up once, when the page is revealed.
 *
 * Assistive technology reads only the final value; the visible count is written straight into its
 * text node, so it costs no React renders while it runs.
 */
export function CountUp({ start, value }: { start: boolean; value: number }) {
  const reducedMotion = useReducedMotion() ?? false
  const ref = useRef<HTMLSpanElement>(null)
  const final = formatter.format(value)

  useEffect(() => {
    const element = ref.current
    if (!element || !start || reducedMotion) return
    let frame = 0
    const begin = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - begin) / durationMs)
      // Ease out: the digits race and then settle, the way a counter reads as landing.
      const eased = 1 - (1 - progress) ** 4
      element.textContent = formatter.format(Math.round(value * eased))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      element.textContent = final
    }
  }, [final, reducedMotion, start, value])

  return (
    <span className="tabular-nums">
      <span aria-hidden="true" ref={ref}>
        {final}
      </span>
      <span className="sr-only">{final}</span>
    </span>
  )
}
