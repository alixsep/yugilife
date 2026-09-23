import { animate } from "framer-motion"

import type { ValueAnimationTransition } from "framer-motion"

/**
 * Seconds. Every move in the donate piece reads its duration from here, so the choreography can
 * be retimed as a whole rather than one tween at a time.
 */
export const donateTiming = {
  /** One heartbeat, while hovered. */
  beat: 1.1,
  /** One full turn; it never stops turning. */
  spin: 3.4,
  /**
   * Taking on weight before the drop, and longer than the prototype's 0.26. The gathering is
   * the half of this that wants watching — it is where the heart stops being an icon — and the
   * drop begins partway into it, at `swell * 0.55`, so this is also what holds the fall back.
   */
  swell: 0.34,
  /** Nominal flight; scaled by the real distance to the floor. */
  fall: 0.34,
  /** The new scene taking the page. */
  arrive: 0.58,
  /**
   * The replacement heart falling in. Paced against the band's 760ms exit rather than against
   * itself: the band uncovers from the top down, so the heart is in clear air for most of its
   * fall, and it lands a little after the crimson has gone — which is the only moment anyone can
   * actually watch it arrive.
   */
  back: 0.42,
  /** Held above the top edge until the band has begun to clear, so the drop is seen at all. */
  backDelay: 0.15,
  /** Easing out of the hover pose. */
  settle: 0.22,
} as const

/** GSAP's power and back eases, as functions framer-motion accepts. */
export const ease = {
  power2In: (t: number) => t * t,
  power2Out: (t: number) => 1 - (1 - t) * (1 - t),
  power2InOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  /**
   * Heavier than gravity. t² is free fall exactly, but over the length of this drop its second
   * half reads as a constant speed — the eye judges acceleration by how much the rate changes,
   * and t² has run out of change by then. Blended most of the way toward t³ the first moments
   * barely move, which is what buys the drop its hang before it commits, and the last stretch
   * pulls harder than t² ever does.
   */
  fallIn: (t: number) => t * t * (0.3 + 0.7 * t),
  power3Out: (t: number) => 1 - (1 - t) ** 3,
  /**
   * The page transition's own pair — `easeInQuart` and `easeOutQuart` in page-transition.tsx.
   * The crimson band is the same gesture as that sweep, so it leaves and returns on the same
   * curve: a quart holds still far longer at the shallow end than a quad, which is what gives
   * the app's sweep its late, decisive rush.
   */
  power4In: (t: number) => t ** 4,
  power4Out: (t: number) => 1 - (1 - t) ** 4,
  backOut: (t: number) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2,
} as const

/**
 * The reveal under the toggle. Both are springs, not durations with a curve painted on: a fold
 * that has to settle against text below it reads wrong unless the settling itself is the motion.
 *
 * The fold has no bounce at all — it is what pushes the note and the plea down the page, and an
 * overshoot there is the shift you feel rather than a flourish you see. Each tile can afford one,
 * because it only moves itself.
 */
export const donateSpring = {
  fold: { type: "spring", duration: 0.34, bounce: 0 },
  tile: { type: "spring", duration: 0.46, bounce: 0.28 },
  /** Between one tile leaving the fold and the next; reversed on the way back in. */
  stagger: 0.07,
} as const

export type AnimationHandle = ReturnType<typeof animate>

export function prefersReducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** Runs a handle to its end and resolves whatever awaits it; used to abandon a move cleanly. */
export function finish(handles: Iterable<AnimationHandle>) {
  for (const handle of handles) handle.complete()
}

/**
 * Tween one number of a plain object.
 *
 * Deliberately the value form of `animate`, never the object form — this is the one place the
 * port cannot follow GSAP's shape. GSAP reads the property each time it starts a tween; motion
 * instead caches a MotionValue per object key, and the choreography here also writes those keys
 * directly: a fall parks `dy` on the floor, a reset puts it back at zero, the frame callback
 * drives `dy` itself while a heart is coming down. A cache never sees those writes, so the second
 * run of a move would start from wherever the first one left off — `animate(place, { dy })` with
 * a stale `dy` is a tween from the floor to the floor, which lands in a single frame. Naming both
 * ends keeps the plain object the only state there is.
 */
export function tween<Key extends string>(
  target: Record<Key, number>,
  key: Key,
  to: number,
  options: Omit<ValueAnimationTransition<number>, "onUpdate">,
) {
  return animate(target[key], to, {
    ...options,
    onUpdate: (value) => {
      target[key] = value
    },
  })
}
