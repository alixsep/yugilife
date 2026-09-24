import { useEffect, useRef, useState } from "react"

import type { CSSProperties, KeyboardEvent } from "react"

const formats = [
  { line: "Lossless, up to 8×.", name: "PNG" },
  { line: "Small file, up to 8×.", name: "JPEG" },
  { line: "Tiny file, full detail.", name: "WebP" },
  { line: "Sharp text, any size.", name: "SVG" },
] as const

/**
 * Each format appears twice, so there is always a copy waiting out of sight above and below and
 * the reel can turn forever in either direction: a copy that has to jump to the other end only
 * ever does so while it is hidden.
 */
const copies = formats.length * 2
/** The reel moves on by itself after this long without a turn. */
const autoAdvanceMs = 5000
/** Wheel travel, in pixels, that turns the reel one step. */
const wheelStep = 40
/** After a step, further wheel input is ignored this long, so a trackpad fling moves it once. */
const wheelRestMs = 180
/** Pixels per line and per page, for wheels that report in those units instead. */
const wheelUnit = [1, 16, 400] as const

const wrap = (value: number, size: number) => ((value % size) + size) % size

/**
 * A vertical reel of the export formats, turned by hand: the wheel, a drag, a click on the format
 * above or below, or the arrow keys. The selected format sits in the middle in the accent colour,
 * with its neighbours blurred above and below, and the line under it describes it.
 */
export function FormatReel() {
  const [position, setPosition] = useState(formats.length - 1)
  const reelRef = useRef<HTMLDivElement>(null)
  const selected = formats[wrap(position, formats.length)]!

  useEffect(() => {
    const reel = reelRef.current
    if (!reel) return
    let wheel = 0
    let restUntil = 0
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      if (event.timeStamp < restUntil) return
      wheel += event.deltaY * (wheelUnit[event.deltaMode] ?? 1)
      if (Math.abs(wheel) < wheelStep) return
      const step = Math.sign(wheel)
      wheel = 0
      restUntil = event.timeStamp + wheelRestMs
      setPosition((current) => current + step)
    }
    reel.addEventListener("wheel", onWheel, { passive: false })
    return () => reel.removeEventListener("wheel", onWheel)
  }, [])

  // Every turn, by hand or by itself, restarts the wait for the next one.
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return
    const timer = window.setTimeout(() => setPosition((current) => current + 1), autoAdvanceMs)
    return () => window.clearTimeout(timer)
  }, [position])

  const dragRef = useRef<{ id: number; y: number } | null>(null)

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") setPosition((current) => current + 1)
    else if (event.key === "ArrowUp") setPosition((current) => current - 1)
    else return
    event.preventDefault()
  }

  return (
    <>
      <div
        ref={reelRef}
        aria-activedescendant={`format-${selected.name}`}
        aria-label="Export formats"
        className="bento-reel"
        role="listbox"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          dragRef.current = { id: event.pointerId, y: event.clientY }
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (!drag || drag.id !== event.pointerId) return
          const row = reelRef.current ? reelRef.current.clientHeight / 3 : 40
          const travelled = drag.y - event.clientY
          if (Math.abs(travelled) < row / 2) return
          const step = Math.sign(travelled)
          setPosition((current) => current + step)
          dragRef.current = { id: drag.id, y: event.clientY }
        }}
        onPointerUp={() => (dragRef.current = null)}
        onPointerCancel={() => (dragRef.current = null)}
      >
        <div className="bento-reel-window">
          {Array.from({ length: copies }, (_, index) => {
            const format = formats[index % formats.length]!
            // Where this copy sits relative to the middle row, from four above to three below.
            const offset = wrap(index - position + formats.length, copies) - formats.length
            const current = offset === 0
            return (
              <span
                key={index}
                aria-hidden={current ? undefined : true}
                aria-selected={current || undefined}
                className="bento-reel-item"
                data-current={current || undefined}
                data-near={Math.abs(offset) === 1 || undefined}
                id={current ? `format-${format.name}` : undefined}
                role={current ? "option" : undefined}
                style={{ "--offset": offset } as CSSProperties}
                onClick={() => {
                  if (Math.abs(offset) === 1) setPosition((value) => value + offset)
                }}
              >
                {format.name}
              </span>
            )
          })}
        </div>
      </div>
      <p aria-live="polite" className="bento-stat-label text-muted-foreground">
        {selected.line}
      </p>
    </>
  )
}
