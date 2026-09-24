import { useEffect, useRef } from "react"

import { ArrowUpRight } from "lucide-react"

import type { CSSProperties } from "react"

/** Copies of the arrow in its ribbon, from two steps behind the centre to two ahead. */
const ribbon = [-2, -1, 0, 1, 2]
/** Time for the ribbon to advance one step while it runs. */
const loopMs = 900
/**
 * The ease the ribbon stops on. Its opening slope is 2, so a stop that lasts twice as long as the
 * same distance would take at full speed leaves at exactly the running speed and only slows from
 * there.
 */
const settleEase = "cubic-bezier(0.3, 0.6, 0.4, 1)"
/** The shortest a stop takes, so an arrow already nearly centred still eases in. */
const shortestSettleMs = 320

/**
 * A link tile's arrow in its circle. At rest only the middle copy is inside the circle. While its
 * tile is hovered or focused, the ribbon runs toward the corner the arrow points at, one step per
 * loop, so an arrow is always leaving as the next comes in, the way a chart's direction marker
 * runs. Letting go does not stop it dead: it carries on at the same speed and eases the arrow
 * that is coming in to rest in the centre, where the copies line up exactly as they started, and
 * picks up from wherever it is if the tile is hovered again.
 */
export function ArrowDisc({ className }: { className?: string }) {
  const ribbonRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const element = ribbonRef.current
    const tile = element?.closest<HTMLElement>(".bento-link")
    if (!element || !tile || typeof element.animate !== "function") return
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return

    let animation: Animation | undefined
    let running = false

    const stepPx = () =>
      parseFloat(getComputedStyle(element).getPropertyValue("--bento-arrow-step")) || 24
    // How far into the current step the ribbon is, read from what is on screen, so a change of
    // direction always starts from exactly where the arrows are.
    const progress = (step: number) =>
      Math.min(1, Math.max(0, (parseFloat(getComputedStyle(element).translate) || 0) / step))
    const at = (step: number, steps: number) => ({
      translate: `${steps * step}px ${-steps * step}px`,
    })
    // A new animation normally waits a frame or more before it starts; pinning its start to now
    // hands over from the previous one without a stall.
    const startNow = (next: Animation, offsetMs = 0) => {
      const now = document.timeline.currentTime
      next.startTime = typeof now === "number" ? now - offsetMs : null
      if (next.startTime === null) next.currentTime = offsetMs
      return next
    }

    const run = () => {
      if (running) return
      running = true
      const step = stepPx()
      const from = progress(step)
      animation?.cancel()
      animation = startNow(
        element.animate([at(step, 0), at(step, 1)], {
          duration: loopMs,
          easing: "linear",
          iterations: Infinity,
        }),
        from * loopMs,
      )
    }

    const settle = () => {
      if (!running) return
      running = false
      const step = stepPx()
      const from = progress(step)
      animation?.cancel()
      // Ends one whole step along, which looks exactly like the start; without a fill the ribbon
      // then drops back to zero with no visible change.
      animation = startNow(
        element.animate([at(step, from), at(step, 1)], {
          duration: Math.max(shortestSettleMs, 2 * (1 - from) * loopMs),
          easing: settleEase,
        }),
      )
    }

    const onFocus = () => {
      if (tile.matches(":focus-visible")) run()
    }
    const onBlur = () => {
      if (!tile.matches(":hover")) settle()
    }
    const onLeave = () => {
      if (!tile.matches(":focus-visible")) settle()
    }

    tile.addEventListener("pointerenter", run)
    tile.addEventListener("pointerleave", onLeave)
    tile.addEventListener("focus", onFocus)
    tile.addEventListener("blur", onBlur)
    return () => {
      tile.removeEventListener("pointerenter", run)
      tile.removeEventListener("pointerleave", onLeave)
      tile.removeEventListener("focus", onFocus)
      tile.removeEventListener("blur", onBlur)
      animation?.cancel()
    }
  }, [])

  return (
    <span aria-hidden="true" className={`bento-arrow ${className ?? ""}`}>
      <span ref={ribbonRef} className="bento-arrow-ribbon">
        {ribbon.map((step) => (
          <ArrowUpRight key={step} strokeWidth={1.5} style={{ "--step": step } as CSSProperties} />
        ))}
      </span>
    </span>
  )
}
