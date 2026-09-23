import { animate, stagger } from "framer-motion"

import { createPathInterpolator } from "@/lib/path-morph"

import { donateTiming, ease, finish, prefersReducedMotion } from "./motion"

import type { AnimationHandle } from "./motion"

/** The pieces of the screen the heart opens into, and the way back out of it. */
export interface ScreenParts {
  /** The light of the break: a radial white that floods out from the point of impact. */
  readonly glow: HTMLElement
  readonly screen: HTMLElement
  readonly fogCanvas: HTMLCanvasElement
  readonly sheet: HTMLElement
  /** The crimson that sweeps down over the sheet on the way out. */
  readonly band: SVGPathElement
}

export interface Arrival {
  /** Resolves when the page belongs to the new screen; the settling keeps running after it. */
  readonly ready: Promise<void>
  /** Ends whatever the arrival left running and clears what it wrote. */
  cancel(): void
}

/** How far a point is from the furthest corner of the viewport. */
function coverRadius(x: number, y: number) {
  const { innerHeight, innerWidth } = window
  return Math.max(
    Math.hypot(x, y),
    Math.hypot(innerWidth - x, y),
    Math.hypot(x, innerHeight - y),
    Math.hypot(innerWidth - x, innerHeight - y),
  )
}

/**
 * The scene takes the page. White blooms out of the point the heart broke and floods the screen;
 * the scene fades up underneath it, over-lit and slightly oversized; then the light drains and it
 * settles into itself.
 *
 * The settling and the content arriving are decoration and deliberately left running, so the
 * sheet accepts a click the moment it looks like it should.
 */
export function arrive(
  { fogCanvas, glow, screen, sheet }: ScreenParts,
  x: number,
  y: number,
): Arrival {
  const reduced = prefersReducedMotion()
  const reach = coverRadius(x, y)
  const handles = new Set<AnimationHandle>()

  glow.style.setProperty("--gx", `${x}px`)
  glow.style.setProperty("--gy", `${y}px`)
  glow.style.setProperty("--glow", "22px")
  glow.style.opacity = "1"
  handles.add(
    animate(22, reach * 1.35, {
      duration: reduced ? 0.08 : 0.4,
      ease: ease.power2Out,
      onUpdate: (radius) => glow.style.setProperty("--glow", `${radius}px`),
    }),
  )
  // it starts draining before it has finished spreading, so the screen is never held blown out —
  // the light passes through rather than sitting on top
  handles.add(
    animate(1, 0, {
      delay: reduced ? 0.06 : 0.22,
      duration: reduced ? 0.06 : 0.54,
      ease: ease.power2InOut,
      onUpdate: (opacity) => {
        glow.style.opacity = String(opacity)
      },
    }),
  )

  fogCanvas.style.transformOrigin = `${x}px ${y}px`
  handles.add(
    animate(0, 1, {
      duration: reduced ? 0.05 : 0.86,
      ease: ease.power2Out,
      onUpdate: (t) => {
        fogCanvas.style.filter = `brightness(${1.32 - 0.32 * t}) saturate(${0.55 + 0.45 * t})`
        fogCanvas.style.transform = `scale(${1.14 - 0.14 * t})`
      },
    }),
  )

  handles.add(
    animate(
      Array.from(sheet.children),
      { opacity: [0, 1], y: [14, 0] },
      {
        delay: stagger(reduced ? 0 : 0.036, { startDelay: donateTiming.arrive * 0.6 }),
        duration: reduced ? 0.001 : 0.38,
        ease: ease.power3Out,
      },
    ),
  )

  // power3.out, not a linear fade: half way through a fade from near-black to near-white is grey,
  // and grey is not what this should look like. The light takes the screen in the first third and
  // the settling does the rest.
  screen.style.opacity = "0"
  const fade = animate(0, 1, {
    duration: reduced ? 0.1 : donateTiming.arrive * 0.9,
    ease: ease.power3Out,
    onUpdate: (opacity) => {
      screen.style.opacity = String(opacity)
    },
  })
  handles.add(fade)

  return {
    ready: fade.then(() => {
      screen.style.opacity = ""
    }),
    cancel() {
      finish(handles)
      handles.clear()
      glow.style.opacity = "0"
      fogCanvas.style.filter = ""
      fogCanvas.style.transform = ""
    },
  }
}

/**
 * The band is the page transition's sweep, entered from the other edge.
 *
 * Same shapes, same two phases, same easings — a flat edge bows into a curve, travels, and
 * flattens again — mirrored in y, because a route change covers upward from the bottom and this
 * covers downward from the top. Written in the transition's own unit box (`viewBox="0 0 1 1"`,
 * `preserveAspectRatio="none"`) so the curve stays the same shape at every window size, and
 * interpolated by its own helper so the two can never drift apart.
 */
const bandPaths = {
  /** Down over the plea, anchored to the top edge. Mirrors `paths.enter`. */
  cover: {
    empty: "M 0 0 V 0 Q .5 0 1 0 V 0 z",
    curve: "M 0 0 V .5 Q .5 1 1 .5 V 0 z",
    full: "M 0 0 V 1 Q .5 1 1 1 V 0 z",
  },
  /** ...and on out of the bottom, anchored there as it goes. Mirrors `paths.exit`. */
  clear: {
    full: "M 0 1 V 0 Q .5 0 1 0 V 1 z",
    curve: "M 0 1 V .5 Q .5 1 1 .5 V 1 z",
    empty: "M 0 1 V 1 Q .5 1 1 1 V 1 z",
  },
} as const

/** The transition's 620:180 and 180:760 split, over the lengths this screen was tuned to. */
const bandTiming = {
  coverLead: 0.364,
  coverSettle: 0.106,
  clearLead: 0.109,
  clearCarry: 0.461,
} as const

type Phase = readonly [to: string, duration: number, easing: (t: number) => number]

/** Runs a path through its phases in order, each starting from where the last one left it. */
async function morph(band: SVGPathElement, from: string, phases: readonly Phase[]) {
  let previous = from
  band.setAttribute("d", previous)
  for (const [to, duration, easing] of phases) {
    const shape = createPathInterpolator(previous, to)
    await animate(0, 1, {
      duration,
      ease: easing,
      onUpdate: (progress) => band.setAttribute("d", shape(progress)),
    })
    previous = to
  }
}

/**
 * Leaving is a different move, not the arrival rewound. The sheet sinks while the band bows down
 * over it; resolves once the crimson covers the screen and the swap underneath can be made.
 */
export function sink({ band, sheet }: ScreenParts) {
  const reduced = prefersReducedMotion()
  const cover = bandTiming.coverLead + bandTiming.coverSettle
  const scale = reduced ? 0.06 / cover : 1
  return Promise.all([
    // Its contents, never the sheet itself. A transform on an element makes it the containing
    // block for every fixed descendant, and the close button in the corner is one: transforming
    // the sheet would re-anchor that button to the sheet's own box, so it would jump inward on
    // the first frame of the close. Animating the children leaves the sheet untouched, and
    // matches the way `arrive` brings them in.
    animate(
      Array.from(sheet.children),
      { opacity: 0, y: 36 },
      { duration: cover * scale * 0.85, ease: ease.power4In },
    ),
    morph(band, bandPaths.cover.empty, [
      [bandPaths.cover.curve, bandTiming.coverLead * scale, ease.power4In],
      [bandPaths.cover.full, bandTiming.coverSettle * scale, ease.power4Out],
    ]),
  ]).then(() => undefined)
}

/** The band carries on out of the bottom, uncovering the page — and then waits above it again. */
export async function sweepOut({ band }: ScreenParts) {
  const reduced = prefersReducedMotion()
  const clear = bandTiming.clearLead + bandTiming.clearCarry
  const scale = reduced ? 0.06 / clear : 1
  await morph(band, bandPaths.clear.full, [
    [bandPaths.clear.curve, bandTiming.clearLead * scale, ease.power4In],
    [bandPaths.clear.empty, bandTiming.clearCarry * scale, ease.power4Out],
  ])
  // Parked at the top edge again, ready for the next cover. Both ends draw nothing.
  band.setAttribute("d", bandPaths.cover.empty)
}
