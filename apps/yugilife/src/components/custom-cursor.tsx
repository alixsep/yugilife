import { useEffect, useId, useRef } from "react"

import { usePreferencesStore } from "@/lib/preferences-store"
import { cn } from "@/lib/utils"

import type { CSSProperties } from "react"

const CURSOR_SIZE = 96
const CURSOR_CENTER = CURSOR_SIZE / 2
const BASE_RADIUS = 13
const HOVER_RADIUS = 22
const TEXT_BURST_RADIUS = 36
const DOT_RADIUS = 2
const HOVER_DOT_RADIUS = 3
const CARET_WIDTH = 3
const CARET_HEIGHT = 24
const CARET_PRESSED_WIDTH = 4
const CARET_PRESSED_HEIGHT = 28

const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount

function roundedRectPath(width: number, height: number, radius: number) {
  const x = CURSOR_CENTER - width / 2
  const y = CURSOR_CENTER - height / 2
  const right = x + width
  const bottom = y + height
  const corner = Math.min(radius, width / 2, height / 2)
  const control = corner * 0.5522848

  return [
    `M ${x + corner} ${y}`,
    `L ${right - corner} ${y}`,
    `C ${right - corner + control} ${y} ${right} ${y + corner - control} ${right} ${y + corner}`,
    `L ${right} ${bottom - corner}`,
    `C ${right} ${bottom - corner + control} ${right - corner + control} ${bottom} ${right - corner} ${bottom}`,
    `L ${x + corner} ${bottom}`,
    `C ${x + corner - control} ${bottom} ${x} ${bottom - corner + control} ${x} ${bottom - corner}`,
    `L ${x} ${y + corner}`,
    `C ${x} ${y + corner - control} ${x + corner - control} ${y} ${x + corner} ${y}`,
    "Z",
  ].join(" ")
}

type CursorMode = "default" | "button" | "text" | "drag"

export type CustomCursorProps = {
  /** CSS selector for elements that provide a typed cursor state. */
  interactiveSelector?: string
  className?: string
}

const cursorStyle: CSSProperties = {
  color: "var(--foreground, #171717)",
  height: CURSOR_SIZE,
  left: 0,
  opacity: 0,
  pointerEvents: "none",
  position: "fixed",
  top: 0,
  width: CURSOR_SIZE,
  willChange: "transform, opacity",
}

const cursorStyles = `
  @media (pointer: fine) and (prefers-reduced-motion: no-preference) {
    html[data-custom-cursor="true"],
    html[data-custom-cursor="true"] * {
      cursor: none !important;
    }
  }

  @media (pointer: coarse), (prefers-reduced-motion: reduce) {
    [data-custom-cursor-ui="true"] {
      display: none;
    }
  }
`

/**
 * A lightweight, two-layer cursor inspired by the Codrops custom SVG cursor.
 *
 * The ring responds smoothly to pointer movement. Typed interactive elements
 * can expand it, become a text caret, or hide it while dragging.
 */
export function CustomCursor({
  className,
  interactiveSelector = '[data-cursor], a, button, [role="button"], input, textarea, select, [data-cursor-hover]',
}: CustomCursorProps) {
  const cursorRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<SVGCircleElement>(null)
  const dotRef = useRef<SVGPathElement>(null)
  const turbulenceRef = useRef<SVGFETurbulenceElement>(null)
  const filterId = `custom-cursor-filter-${useId().replace(/:/g, "")}`
  const cursorPreference = usePreferencesStore((state) => state.cursor)

  useEffect(() => {
    const cursor = cursorRef.current
    const ring = ringRef.current
    const dot = dotRef.current
    const turbulence = turbulenceRef.current

    if (!cursor || !ring || !dot || !turbulence) return

    if (cursorPreference === "native") return
    if (typeof window.matchMedia !== "function") return

    const finePointer = window.matchMedia("(pointer: fine)")
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    if (!finePointer.matches || reducedMotion.matches) return

    document.documentElement.dataset.customCursor = "true"

    const target = { x: 0, y: 0 }
    let cursorMode: CursorMode = "default"
    let pressed = false
    let selectingText = false
    let nativeDragging = false
    let visible = false
    let distortion = 0
    let frameId: number | null = null
    let cursorOpacity = 0
    let ringRadius = BASE_RADIUS
    let ringOpacity = 1
    let dotOpacity = 1
    let dotWidth = DOT_RADIUS * 2
    let dotHeight = DOT_RADIUS * 2
    let dotCornerRadius = DOT_RADIUS
    let filterActive = false
    let lastPointerMoveAt = 0
    let lastPointerX = 0
    let lastPointerY = 0

    const interactiveElement = (node: EventTarget | null): Element | null => {
      if (!(node instanceof Element)) return null

      try {
        return node.closest(interactiveSelector)
      } catch {
        return null
      }
    }

    const modeForElement = (element: Element | null): CursorMode => {
      if (!element) return "default"

      const explicitMode = element.getAttribute("data-cursor")
      if (
        explicitMode === "default" ||
        explicitMode === "button" ||
        explicitMode === "text" ||
        explicitMode === "drag"
      ) {
        return explicitMode
      }

      if (
        element.matches("input, textarea") &&
        !element.matches(
          '[type="button"], [type="submit"], [type="reset"], [type="checkbox"], [type="radio"], [type="range"]',
        )
      ) {
        return "text"
      }

      return "button"
    }

    const setCursorMode = (nextMode: CursorMode) => {
      if (nextMode !== cursorMode && nextMode !== "default") distortion = 0.28
      cursorMode = nextMode
    }

    const syncCursorMode = (clientX: number, clientY: number) => {
      setCursorMode(modeForElement(interactiveElement(document.elementFromPoint(clientX, clientY))))
    }

    const updatePosition = (clientX: number, clientY: number) => {
      target.x = clientX
      target.y = clientY
      visible = true
      scheduleRender()
    }

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== "mouse" && event.pointerType !== "pen") {
        return
      }

      lastPointerMoveAt = performance.now()
      lastPointerX = event.clientX
      lastPointerY = event.clientY
      updatePosition(event.clientX, event.clientY)
      if (event.buttons === 0) pressed = false
      syncCursorMode(event.clientX, event.clientY)
    }

    // Native text selection/dragging can interrupt the pointer event stream in
    // some browsers. Mousemove keeps the visual cursor alive during that path.
    const onMouseMove = (event: MouseEvent) => {
      const now = performance.now()
      if (
        event.clientX === lastPointerX &&
        event.clientY === lastPointerY &&
        now - lastPointerMoveAt < 16
      ) {
        return
      }

      updatePosition(event.clientX, event.clientY)
      if (event.buttons === 0) pressed = false
      syncCursorMode(event.clientX, event.clientY)
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return
      pressed = true
      scheduleRender()
    }

    const onPointerUp = (event: PointerEvent) => {
      pressed = false
      selectingText = false
      nativeDragging = false
      syncCursorMode(event.clientX, event.clientY)
      scheduleRender()
    }

    const onMouseUp = (event: MouseEvent) => {
      pressed = false
      selectingText = false
      nativeDragging = false
      syncCursorMode(event.clientX, event.clientY)
      scheduleRender()
    }

    const onDragStart = () => {
      pressed = false
      selectingText = false
      nativeDragging = true
      setCursorMode("drag")
      scheduleRender()
    }

    const onSelectStart = () => {
      // Selecting text does not always produce a matching pointerup. Switch
      // to the caret shape immediately and let mousemove keep it positioned.
      pressed = false
      selectingText = true
      setCursorMode("text")
      scheduleRender()
    }

    const onDrag = (event: DragEvent) => {
      // DragEvent coordinates are allowed to be 0,0 when the browser cannot
      // provide the dragged pointer position. Never send that sentinel to the
      // cursor or it will jump to the top-left corner.
      if (event.clientX <= 0 && event.clientY <= 0) return
      if (event.clientX < 0 || event.clientY < 0) return
      updatePosition(event.clientX, event.clientY)
      syncCursorMode(event.clientX, event.clientY)
    }

    const onDragEnd = (event: DragEvent) => {
      pressed = false
      nativeDragging = false
      selectingText = false
      if (event.clientX > 0 || event.clientY > 0) syncCursorMode(event.clientX, event.clientY)
      scheduleRender()
    }

    const hideCursor = () => {
      visible = false
      pressed = false
      selectingText = false
      nativeDragging = false
      cursorMode = "default"
      scheduleRender()
    }

    const render = () => {
      const activeMode = nativeDragging ? "drag" : selectingText ? "text" : cursorMode
      const textMode = activeMode === "text"
      const dragMode = activeMode === "drag"
      const radiusTarget = pressed
        ? BASE_RADIUS - 3
        : textMode
          ? TEXT_BURST_RADIUS
          : activeMode === "button" || activeMode === "drag"
            ? HOVER_RADIUS
            : BASE_RADIUS
      const dotRadiusTarget =
        pressed || activeMode === "button" || activeMode === "drag" ? HOVER_DOT_RADIUS : DOT_RADIUS
      const targetDotWidth = textMode
        ? pressed
          ? CARET_PRESSED_WIDTH
          : CARET_WIDTH
        : dotRadiusTarget * 2
      const targetDotHeight = textMode
        ? pressed
          ? CARET_PRESSED_HEIGHT
          : CARET_HEIGHT
        : dotRadiusTarget * 2
      const targetDotCornerRadius = textMode ? targetDotWidth / 2 : dotRadiusTarget

      // The position is never eased: any smoothing here is felt as the cursor trailing the hand.
      cursor.style.transform = `translate3d(${target.x - CURSOR_CENTER}px, ${target.y - CURSOR_CENTER}px, 0)`
      cursorOpacity = lerp(cursorOpacity, visible ? 1 : 0, 0.18)
      cursor.style.opacity = String(cursorOpacity)
      ringRadius = lerp(ringRadius, radiusTarget, 0.16)
      ring.setAttribute("r", String(ringRadius))
      dotWidth = lerp(dotWidth, targetDotWidth, 0.2)
      dotHeight = lerp(dotHeight, targetDotHeight, 0.2)
      dotCornerRadius = lerp(dotCornerRadius, targetDotCornerRadius, 0.2)
      dot.setAttribute("d", roundedRectPath(dotWidth, dotHeight, dotCornerRadius))
      ringOpacity = lerp(ringOpacity, dragMode || textMode ? 0 : 1, 0.2)
      ring.setAttribute("opacity", String(ringOpacity))
      dotOpacity = lerp(dotOpacity, 1, 0.2)
      dot.setAttribute("opacity", String(dotOpacity))
      distortion = lerp(distortion, 0, 0.12)
      if (distortion > 0.001) {
        if (!filterActive) {
          ring.setAttribute("filter", `url(#${filterId})`)
          filterActive = true
        }
        turbulence.setAttribute("baseFrequency", `${distortion} ${distortion}`)
      } else if (filterActive) {
        turbulence.setAttribute("baseFrequency", "0 0")
        ring.removeAttribute("filter")
        filterActive = false
      }

      const visualSettled =
        Math.abs(ringRadius - radiusTarget) < 0.1 &&
        Math.abs(ringOpacity - (dragMode || textMode ? 0 : 1)) < 0.01 &&
        Math.abs(dotWidth - targetDotWidth) < 0.1 &&
        Math.abs(dotHeight - targetDotHeight) < 0.1 &&
        distortion <= 0.001

      return !(visualSettled && (!visible ? cursorOpacity <= 0.01 : true))
    }

    const scheduleRender = () => {
      if (frameId !== null) return
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        if (render()) scheduleRender()
      })
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") hideCursor()
    }

    // Slider drags stop propagation in their React handlers. Capture the
    // pointer stream before it reaches the app so the cursor keeps following.
    window.addEventListener("pointermove", onPointerMove, { capture: true, passive: true })
    window.addEventListener("mousemove", onMouseMove, { capture: true, passive: true })
    window.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true })
    window.addEventListener("pointerup", onPointerUp, { capture: true, passive: true })
    window.addEventListener("pointercancel", onPointerUp, { capture: true, passive: true })
    window.addEventListener("lostpointercapture", onPointerUp, { capture: true, passive: true })
    window.addEventListener("mouseup", onMouseUp, { capture: true, passive: true })
    window.addEventListener("selectstart", onSelectStart, { capture: true, passive: true })
    window.addEventListener("drag", onDrag, { capture: true, passive: true })
    window.addEventListener("dragstart", onDragStart, { capture: true, passive: true })
    window.addEventListener("dragend", onDragEnd, { capture: true, passive: true })
    window.addEventListener("drop", onDragEnd, { capture: true, passive: true })
    document.addEventListener("mouseleave", hideCursor)
    document.addEventListener("visibilitychange", onVisibilityChange)
    window.addEventListener("blur", hideCursor)
    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      window.removeEventListener("pointermove", onPointerMove, true)
      window.removeEventListener("mousemove", onMouseMove, true)
      window.removeEventListener("pointerdown", onPointerDown, true)
      window.removeEventListener("pointerup", onPointerUp, true)
      window.removeEventListener("pointercancel", onPointerUp, true)
      window.removeEventListener("lostpointercapture", onPointerUp, true)
      window.removeEventListener("mouseup", onMouseUp, true)
      window.removeEventListener("selectstart", onSelectStart, true)
      window.removeEventListener("drag", onDrag, true)
      window.removeEventListener("dragstart", onDragStart, true)
      window.removeEventListener("dragend", onDragEnd, true)
      window.removeEventListener("drop", onDragEnd, true)
      document.removeEventListener("mouseleave", hideCursor)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("blur", hideCursor)
      delete document.documentElement.dataset.customCursor
    }
  }, [cursorPreference, filterId, interactiveSelector])

  if (cursorPreference === "native") return null

  return (
    <>
      <style>{cursorStyles}</style>
      <div
        ref={cursorRef}
        aria-hidden="true"
        className={cn("pointer-events-none fixed top-0 left-0 z-[9999]", className)}
        data-custom-cursor-ui="true"
        style={cursorStyle}
      >
        <svg
          aria-hidden="true"
          className="absolute inset-0 overflow-visible"
          height={CURSOR_SIZE}
          viewBox={`0 0 ${CURSOR_SIZE} ${CURSOR_SIZE}`}
          width={CURSOR_SIZE}
        >
          <defs>
            <filter
              height="220%"
              id={filterId}
              width="220%"
              x="-60%"
              y="-60%"
              filterUnits="objectBoundingBox"
            >
              <feTurbulence
                ref={turbulenceRef}
                baseFrequency="0 0"
                numOctaves="1"
                result="warp"
                type="fractalNoise"
              />
              <feDisplacementMap
                in="SourceGraphic"
                scale="14"
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          </defs>

          <circle
            ref={ringRef}
            cx={CURSOR_CENTER}
            cy={CURSOR_CENTER}
            fill="none"
            r={BASE_RADIUS}
            stroke="currentColor"
            strokeWidth="1.25"
          />
          <path
            ref={dotRef}
            d={roundedRectPath(DOT_RADIUS * 2, DOT_RADIUS * 2, DOT_RADIUS)}
            fill="currentColor"
          />
        </svg>
      </div>
    </>
  )
}
