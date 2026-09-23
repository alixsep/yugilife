import { useEffect, useRef, useState } from "react"

import * as DialogPrimitive from "@radix-ui/react-dialog"
import { createPortal, flushSync } from "react-dom"

import { fontWeights } from "@/lib/font-weight"
import { useSize } from "@/lib/size-context"
import { cn } from "@/lib/utils"

import { DonateSheet } from "./donate-sheet"
import { createFog } from "./fog"
import { createHeartSprite } from "./heart-sprite"
import { arrive, sink, sweepOut } from "./screen-transitions"

import type { Fog } from "./fog"
import type { HeartSprite } from "./heart-sprite"
import type { Arrival, ScreenParts } from "./screen-transitions"

/**
 * Support button → the screen behind it.
 *
 * The heart is not an ornament. Pressing Donate makes it real: it swells to its native size, the
 * weight takes it straight down, and it breaks on the floor of the page. The light of that break
 * floods the screen, and the donation scene is what is left when the light drains away. Coming
 * back is a different move again — see `closeSheet`.
 *
 * The screen is an overlay rather than a route on purpose: most people press this from the
 * builder, and a route change would throw away the card they are working on.
 */
export function DonateButton() {
  // The pill sits on the navbar's own control ladder, and grows its label at the same width the
  // nav items grow theirs. Only its colour is its own.
  const sizeClasses = useSize()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const slotRef = useRef<HTMLSpanElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const glowRef = useRef<HTMLDivElement>(null)
  const bandRef = useRef<SVGPathElement>(null)
  const screenRef = useRef<HTMLElement>(null)
  const fogCanvasRef = useRef<HTMLCanvasElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)

  const spriteRef = useRef<HeartSprite | null>(null)
  const fogRef = useRef<Fog | null>(null)
  const arrivalRef = useRef<Arrival | null>(null)
  // one transition at a time; the pointer and focus flags only matter to the heart, not to React
  const busy = useRef(false)
  // a close asked for mid-arrival is honoured once the sheet has arrived, not dropped
  const closeRequested = useRef(false)
  const pointerInside = useRef(false)
  const focused = useRef(false)

  const [open, setOpen] = useState(false)
  // the screen is shown only between the heart's break and the band's sweep
  const [screenShown, setScreenShown] = useState(false)
  // the no-WebGL stand-in, shown only once the 3D heart is known to be unavailable
  const [flatHeart, setFlatHeart] = useState(false)

  const isActive = () => (pointerInside.current || focused.current) && !busy.current
  const syncActive = () => spriteRef.current?.setActive(isActive())

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let disposed = false
    let sprite: HeartSprite | null = null
    void createHeartSprite({
      canvas,
      seat: () => slotRef.current?.getBoundingClientRect(),
    }).then((made) => {
      if (disposed) {
        made?.dispose()
        return
      }
      sprite = made
      spriteRef.current = made
      if (made) made.setActive((pointerInside.current || focused.current) && !busy.current)
      else setFlatHeart(true)
    })
    return () => {
      disposed = true
      sprite?.dispose()
      spriteRef.current = null
    }
  }, [])

  useEffect(() => {
    const fogCanvas = fogCanvasRef.current
    if (!fogCanvas) return
    const fog = createFog(fogCanvas)
    fogRef.current = fog
    return () => {
      fog.dispose()
      fogRef.current = null
    }
  }, [])

  const parts = (): ScreenParts | undefined => {
    const glow = glowRef.current
    const screen = screenRef.current
    const fogCanvas = fogCanvasRef.current
    const sheet = sheetRef.current
    const band = bandRef.current
    if (!glow || !screen || !fogCanvas || !sheet || !band) return undefined
    return { band, fogCanvas, glow, screen, sheet }
  }

  /** Button → donation sheet, out of the break. */
  const openSheet = async () => {
    if (busy.current) return
    busy.current = true
    closeRequested.current = false
    syncActive()
    // the sheet is mounted now, hidden inside the screen, so its content exists to be arrived at
    flushSync(() => setOpen(true))

    // the heart falls and breaks; it tells us where
    const sprite = spriteRef.current
    const [x, y] = sprite
      ? await sprite.breakOnFloor()
      : [window.innerWidth / 2, window.innerHeight - 30]

    const screenParts = parts()
    if (!screenParts) {
      busy.current = false
      return
    }
    flushSync(() => setScreenShown(true))
    fogRef.current?.start() // sized and painted before it is faded up
    const arrival = arrive(screenParts, x, y)
    arrivalRef.current = arrival
    await arrival.ready

    sprite?.reset()
    sprite?.setVisible(false)
    screenParts.sheet.focus({ preventScroll: true })
    busy.current = false
    if (closeRequested.current) void closeSheet()
  }

  /**
   * Leaving is a different move, not the arrival rewound. The sheet sinks, a crimson band sweeps
   * down over it and keeps going off the bottom, uncovering the page — and a new heart falls in
   * from above behind it.
   */
  const closeSheet = async () => {
    if (busy.current) {
      closeRequested.current = true
      return
    }
    closeRequested.current = false
    const screenParts = parts()
    if (!screenParts) {
      setOpen(false)
      return
    }
    busy.current = true

    // 1. the sheet sinks away while the band comes down over it
    await sink(screenParts)

    // 2. swap underneath, while the crimson hides the cut
    setScreenShown(false)
    fogRef.current?.stop()
    arrivalRef.current?.cancel()
    arrivalRef.current = null
    setOpen(false)

    // 3. the band carries on out of the bottom and the new heart falls in behind it. dropIn parks
    // the heart above the page before it is made visible again, otherwise it shows for a frame
    // sitting in the button, over the band.
    const sprite = spriteRef.current
    const falling = sprite ? sprite.dropIn() : Promise.resolve()
    sprite?.setVisible(true)
    await Promise.all([sweepOut(screenParts), falling])

    busy.current = false
    syncActive()
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={cn(
          "relative inline-flex aspect-square cursor-pointer items-center justify-center",
          "rounded-full select-none",
          sizeClasses.control,
          sizeClasses.text,
          "lg:aspect-auto lg:w-auto lg:justify-start lg:pr-4 lg:pl-[10px]",
          "bg-[linear-gradient(180deg,#ff3563_0%,#e51a4b_55%,#d11341_100%)] text-white",
          "shadow-[0_1px_1px_rgba(120,10,40,0.22),0_10px_22px_-10px_rgba(225,29,72,0.85),inset_0_1px_0_rgba(255,255,255,0.28)]",
          "tracking-[-0.2px]",
          "[transition:translate_90ms_cubic-bezier(0.22,1,0.36,1),scale_90ms_cubic-bezier(0.22,1,0.36,1),box-shadow_200ms_cubic-bezier(0.22,1,0.36,1)]",
          "hover:-translate-y-px",
          "hover:shadow-[0_2px_2px_rgba(120,10,40,0.22),0_14px_28px_-10px_rgba(225,29,72,0.95),inset_0_1px_0_rgba(255,255,255,0.34)]",
          "active:translate-y-0 active:scale-[0.978]",
          "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[#e11d48]",
          "motion-reduce:transition-none",
        )}
        style={{ fontVariationSettings: fontWeights.semibold }}
        aria-label="Support"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-cursor="button"
        onClick={() => void openSheet()}
        onPointerEnter={() => {
          pointerInside.current = true
          syncActive()
        }}
        onPointerLeave={() => {
          pointerInside.current = false
          syncActive()
        }}
        onPointerCancel={() => {
          pointerInside.current = false
          syncActive()
        }}
        onFocus={(event) => {
          // a mouse click shouldn't leave it lit
          focused.current = event.currentTarget.matches(":focus-visible")
          syncActive()
        }}
        onBlur={() => {
          focused.current = false
          pointerInside.current = false
          syncActive()
        }}
      >
        {/* The heart's seat. The 3D heart is a fixed canvas that follows this box every frame. */}
        <span ref={slotRef} className="relative block size-[17px] shrink-0 lg:mr-1.5">
          {flatHeart ? (
            <svg
              viewBox="0 0 24 24"
              className="block size-[17px] text-[#ffd9e2]"
              aria-hidden="true"
            >
              <path
                fill="currentColor"
                d="M12 21C6.1 16.8 3 13.2 3 9.6 3 6.5 5.4 4 8.4 4c1.8 0 3 .9 3.6 2 .6-1.1 1.8-2 3.6-2C18.6 4 21 6.5 21 9.6c0 3.6-3.1 7.2-9 11.4Z"
              />
            </svg>
          ) : null}
        </span>
        <span className="hidden whitespace-nowrap lg:inline">Support</span>
      </button>

      {createPortal(
        <>
          {/* Lit at all times because it sits on crimson; hovering only lifts it. */}
          {flatHeart ? null : (
            <canvas
              ref={canvasRef}
              aria-hidden="true"
              className={cn(
                "pointer-events-none fixed top-0 left-0 z-40 size-7",
                "brightness-[0.97] data-[active=true]:brightness-100",
                "transition-[filter] duration-[240ms] ease-out motion-reduce:transition-none",
              )}
            />
          )}
          {/* The light of the break. Its last stop is fully transparent, so it has no edge: it
              floods the screen from the point of impact without cutting it. */}
          <div
            ref={glowRef}
            aria-hidden="true"
            className={cn(
              "pointer-events-none fixed inset-0 z-[62] opacity-0 [will-change:opacity,background]",
              "bg-[radial-gradient(circle_var(--glow,0px)_at_var(--gx,50%)_var(--gy,100%),#ffffff_0%,#ffffff_46%,rgba(255,255,255,0.8)_66%,rgba(255,255,255,0)_100%)]",
            )}
          />
          {/* The way out is its own move: this bows down over the plea, covers it, and keeps going
              off the bottom, uncovering the page behind it. The same swept curve the page
              transition uses, entered from the top instead of the bottom — a unit viewBox with no
              aspect ratio preserved, so one path describes it at any window size. It draws nothing
              until sink() gives it a shape. */}
          <svg
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 z-[61] h-[100dvh] w-[100vw]"
            preserveAspectRatio="none"
            viewBox="0 0 1 1"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path ref={bandRef} d="M 0 0 V 0 Q .5 0 1 0 V 0 z" fill="#e11d48" />
          </svg>
          <DialogPrimitive.Root
            open={open}
            onOpenChange={(next) => {
              if (!next) void closeSheet()
            }}
          >
            <section
              ref={screenRef}
              hidden={!screenShown}
              className={cn(
                "fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto px-5 py-10",
                // The gutter is reserved on both edges from the start. Opening the codes makes
                // this screen taller than the viewport, and without this its scrollbar appears at
                // that moment and shoves the centred column sideways — a shift the reveal itself
                // has nothing to do with. Both edges, so the column stays centred either way.
                "[scrollbar-gutter:stable_both-edges]",
                // The white is only what shows before the fog paints its first frame.
                "bg-white",
                // Needed because display:flex otherwise beats the user agent's rule for [hidden].
                "[&[hidden]]:hidden",
              )}
            >
              {/* Fixed, not absolute: the screen scrolls, and the fog is the sky behind it rather
                  than part of the page that moves with it. */}
              <canvas
                ref={fogCanvasRef}
                aria-hidden="true"
                className="fixed inset-0 z-0 block h-full w-full"
              />
              <DialogPrimitive.Content
                asChild
                onOpenAutoFocus={(event) => event.preventDefault()}
                onInteractOutside={(event) => event.preventDefault()}
              >
                <DonateSheet ref={sheetRef} />
              </DialogPrimitive.Content>
            </section>
          </DialogPrimitive.Root>
        </>,
        document.body,
      )}
    </>
  )
}
