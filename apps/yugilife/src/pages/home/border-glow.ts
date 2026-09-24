import { useEffect } from "react"

import type { RefObject } from "react"

import "./border-glow.css"

/** Pointer speed, in px per ms, at which the borders reach full strength. */
const fullSpeed = 1.6
/** How long the light stays at its strength after the pointer last moved, in ms. */
const holdMs = 450
/** Time constant of the fade after the hold, and of the rise toward a new strength, in ms. */
const fadeMs = 900
const riseMs = 140

/**
 * Lights the tile borders near the pointer while it is moving. Off unless `enabled` is passed:
 * switched off, it neither listens to the pointer nor draws anything.
 *
 * The pointer's viewport position and a 0–1 strength are written to CSS custom properties on the
 * grid; every tile draws its border from those alone (see border-glow.css), so a move costs
 * one style write and no React render. Strength follows the pointer's speed: it swells in, holds
 * for a moment after the pointer stops, and then fades slowly, so resting the mouse on a tile
 * leaves no border behind. Only a mouse or pen drives it.
 */
export function useBorderGlow(ref: RefObject<HTMLElement | null>, enabled = false) {
  useEffect(() => {
    const element = ref.current
    if (!enabled || !element || typeof window.matchMedia !== "function") return
    if (!window.matchMedia("(pointer: fine)").matches) return
    element.dataset.borderGlow = ""

    // `energy` is what the pointer's speed asks for; `glow` is what is drawn, easing toward it, so
    // the light swells in and lingers instead of snapping on and off.
    let energy = 0
    let glow = 0
    let frame = 0
    let lastFrame = 0
    let lastX = 0
    let lastY = 0
    let lastTime = Number.NEGATIVE_INFINITY

    const step = (now: number) => {
      const elapsed = Math.min(64, now - lastFrame)
      lastFrame = now
      if (now - lastTime > holdMs) energy *= Math.exp(-elapsed / fadeMs)
      glow += (energy - glow) * (1 - Math.exp(-elapsed / riseMs))
      if (energy < 0.004 && glow < 0.004) {
        energy = 0
        glow = 0
        frame = 0
      } else {
        frame = requestAnimationFrame(step)
      }
      element.style.setProperty("--bento-glow", glow.toFixed(3))
    }

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return
      const elapsed = event.timeStamp - lastTime
      const distance = Math.hypot(event.clientX - lastX, event.clientY - lastY)
      lastX = event.clientX
      lastY = event.clientY
      lastTime = event.timeStamp
      element.style.setProperty("--bento-pointer-x", `${event.clientX}px`)
      element.style.setProperty("--bento-pointer-y", `${event.clientY}px`)
      // The first move after a rest has no meaningful speed yet.
      if (elapsed > 100) return
      energy = Math.max(energy, Math.min(1, distance / Math.max(1, elapsed) / fullSpeed))
      if (!frame) {
        lastFrame = performance.now()
        frame = requestAnimationFrame(step)
      }
    }

    window.addEventListener("pointermove", onPointerMove, { passive: true })
    return () => {
      window.removeEventListener("pointermove", onPointerMove)
      cancelAnimationFrame(frame)
      delete element.dataset.borderGlow
      for (const property of ["--bento-glow", "--bento-pointer-x", "--bento-pointer-y"]) {
        element.style.removeProperty(property)
      }
    }
  }, [enabled, ref])
}
