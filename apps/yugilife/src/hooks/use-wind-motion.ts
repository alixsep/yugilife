"use client"

import { useEffect } from "react"

import { subscribeDeviceTilt } from "@/lib/device-tilt"

import type { RefObject } from "react"

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * Gives an element a small, spring-damped response to movement around it.
 *
 * Pointer input is treated as an impulse, not as a position: the card catches
 * a little wind and then settles back to rest, so it never follows the cursor.
 * Supported device orientation is used as the sustained input instead. The
 * shared device-tilt service handles permission on the first app interaction.
 */
export function useWindMotion<T extends HTMLElement>(ref: RefObject<T | null>) {
  useEffect(() => {
    const element = ref.current
    if (!element || typeof window === "undefined") return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    const hasFinePointer = window.matchMedia("(pointer: fine)").matches
    const target = { x: 0, y: 0 }
    const current = { x: 0, y: 0 }
    let animationFrame: number | null = null
    let previousPointer: { x: number; y: number } | null = null
    let lastFrameTime = performance.now()
    let orientationListening = false

    const writeMotion = () => {
      // Keep the movement deliberately small: this is a gust across the
      // element, not a hover-tilt interaction that tracks pointer location.
      element.style.setProperty("--wind-motion-x", `${(current.x * 4).toFixed(3)}px`)
      element.style.setProperty("--wind-motion-y", `${(current.y * 2.5).toFixed(3)}px`)
      element.style.setProperty("--wind-motion-tilt-x", `${(current.x * 1.65).toFixed(3)}deg`)
      element.style.setProperty("--wind-motion-tilt-y", `${(current.y * -1.65).toFixed(3)}deg`)
      element.style.setProperty("--wind-motion-roll", `${(current.x * 0.55).toFixed(3)}deg`)
    }

    const tick = (time: number) => {
      animationFrame = null
      const delta = Math.min((time - lastFrameTime) / 1000, 0.1)
      lastFrameTime = time

      if (!orientationListening) {
        const decay = Math.exp(-delta * 5.25)
        target.x *= decay
        target.y *= decay
      }

      const follow = 1 - Math.exp(-delta * 8)
      current.x += (target.x - current.x) * follow
      current.y += (target.y - current.y) * follow
      writeMotion()

      const isSettled =
        Math.abs(current.x - target.x) < 0.001 &&
        Math.abs(current.y - target.y) < 0.001 &&
        (orientationListening || (Math.abs(target.x) < 0.001 && Math.abs(target.y) < 0.001))
      if (!isSettled) animationFrame = window.requestAnimationFrame(tick)
    }

    const schedule = () => {
      if (animationFrame === null) animationFrame = window.requestAnimationFrame(tick)
    }

    const handlePointerEnter = (event: PointerEvent) => {
      previousPointer = { x: event.clientX, y: event.clientY }
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return

      if (!previousPointer) {
        previousPointer = { x: event.clientX, y: event.clientY }
        return
      }

      const deltaX = event.clientX - previousPointer.x
      const deltaY = event.clientY - previousPointer.y
      previousPointer = { x: event.clientX, y: event.clientY }

      target.x = clamp(target.x + deltaX * 0.028, -1, 1)
      target.y = clamp(target.y + deltaY * 0.022, -1, 1)
      schedule()
    }

    const handlePointerLeave = () => {
      previousPointer = null
    }

    const unsubscribeTilt = subscribeDeviceTilt((tilt) => {
      orientationListening = true
      target.x = tilt.x
      target.y = tilt.y
      schedule()
    })

    if (hasFinePointer) {
      element.addEventListener("pointerenter", handlePointerEnter)
      element.addEventListener("pointermove", handlePointerMove)
      element.addEventListener("pointerleave", handlePointerLeave)
    }
    return () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
      if (hasFinePointer) {
        element.removeEventListener("pointerenter", handlePointerEnter)
        element.removeEventListener("pointermove", handlePointerMove)
        element.removeEventListener("pointerleave", handlePointerLeave)
      }
      unsubscribeTilt()
      element.style.removeProperty("--wind-motion-x")
      element.style.removeProperty("--wind-motion-y")
      element.style.removeProperty("--wind-motion-tilt-x")
      element.style.removeProperty("--wind-motion-tilt-y")
      element.style.removeProperty("--wind-motion-roll")
    }
  }, [ref])
}
