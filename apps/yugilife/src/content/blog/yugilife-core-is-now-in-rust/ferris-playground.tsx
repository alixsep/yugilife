import { useEffect, useRef } from "react"

import { LOADING_COMPLETE_EVENT } from "@/lib/loading-screen-event"

import {
  callCrab,
  CARD_HEIGHT,
  CARD_IDS,
  CARD_WIDTH,
  createWorld,
  dragCard,
  grabCard,
  jumpCrab,
  lookAt,
  petCrab,
  releaseCard,
  resizeWorld,
  RUN_SPEED,
  setKeys,
  step,
  tossOrFetch,
  WALK_SPEED,
} from "./ferris-simulation"

import type { World } from "./ferris-simulation"
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react"

import "./ferris-playground.css"

/** Distance from the stage's bottom edge to the floor line Ferris stands on. */
const FLOOR = 44
/** Ferris's SVG box; its origin is the point between the feet. */
const CRAB_BOX = { height: 150, left: 75, top: 140, width: 150 }
const PARTICLE_SLOTS = 40
const DEG = 180 / Math.PI

/**
 * The stage has no box around it, so nothing clips a thrown card at its top edge. Instead, cards
 * may rise until their top edge is a little above the stage, and then fall back down.
 */
function cardCeiling(stageHeight: number) {
  return stageHeight - FLOOR - CARD_HEIGHT / 2 + 24
}

/** Spiky dome on top, soft belly below, like Ferris. */
const BODY_PATH = (() => {
  const spikes = 13
  const [cx, cy, rx, ry] = [0, -40, 50, 32]
  const points: string[] = []
  for (let index = 0; index <= spikes * 2; index++) {
    const angle = Math.PI + (index / (spikes * 2)) * Math.PI
    const scale = index % 2 === 1 ? 1.18 : 1
    const x = cx + rx * Math.cos(angle) * scale
    const y = cy + ry * Math.sin(angle) * scale
    points.push(`${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
  }
  const belly = cy + 22
  return `${points.join(" ")} C${cx + rx} ${cy + 15} ${cx + rx * 0.55} ${belly} ${cx} ${belly} C${cx - rx * 0.55} ${belly} ${cx - rx} ${cy + 15} ${cx - rx} ${cy} Z`
})()

/**
 * A filled limb that narrows along its centerline, given as [x, y, half-width] points. A last
 * half-width of 0 ends it in a sharp point.
 */
function taperedPath(points: readonly (readonly [number, number, number])[]) {
  const normals = points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)] ?? point
    const next = points[Math.min(points.length - 1, index + 1)] ?? point
    const [dx, dy] = [next[0] - previous[0], next[1] - previous[1]]
    const length = Math.hypot(dx, dy) || 1
    return [-dy / length, dx / length] as const
  })
  const side = (sign: number) =>
    points.map(([x, y, width], index) => {
      const [nx, ny] = normals[index] ?? [0, 0]
      return `${(x + nx * width * sign).toFixed(1)} ${(y + ny * width * sign).toFixed(1)}`
    })
  const there = side(1)
  const back = side(-1).reverse()
  return `M${there.join(" L")} L${back.join(" L")} Z`
}

/**
 * Three walking legs a side. Each rises from its hip to a knee above it, then comes down to a
 * pointed tip on the floor, so the crab stands on its toes.
 */
const LEGS = [
  { knee: 9, phase: 0, reach: 15, x: -14, y: -20 },
  { knee: 11, phase: 2.1, reach: 20, x: -25, y: -22 },
  { knee: 13, phase: 4.2, reach: 24, x: -35, y: -25 },
  { knee: 9, phase: Math.PI, reach: 15, x: 14, y: -20 },
  { knee: 11, phase: Math.PI + 2.1, reach: 20, x: 25, y: -22 },
  { knee: 13, phase: Math.PI + 4.2, reach: 24, x: 35, y: -25 },
].map((leg) => {
  const side = leg.x < 0 ? -1 : 1
  return {
    ...leg,
    path: taperedPath([
      [leg.x, leg.y, 3.4],
      [leg.x + side * leg.knee, leg.y - 6, 2.9],
      [leg.x + side * (leg.reach - 3), -6, 1.6],
      [leg.x + side * leg.reach, -0.5, 0],
    ]),
  }
})

/** Upper arm from the shoulder to the wrist, tapering toward the pincer. */
const ARM_PATH = taperedPath([
  [0, 0, 5],
  [9, -6, 4.4],
  [14, -15, 3.8],
])

function ToyCard() {
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${CARD_WIDTH} ${CARD_HEIGHT}`}>
      <rect
        className="ferris-playground__card-front"
        fill="#fff"
        height="65"
        rx="3"
        stroke="rgb(0 0 0 / 0.18)"
        width="45"
        x="0.5"
        y="0.5"
      />
      <g className="ferris-playground__card-back">
        <rect
          fill="#3a271b"
          height="65"
          rx="3"
          stroke="rgb(0 0 0 / 0.35)"
          width="45"
          x="0.5"
          y="0.5"
        />
        <rect fill="none" height="57" rx="2" stroke="#7a4a26" width="37" x="4.5" y="4.5" />
        <ellipse cx="23" cy="33" fill="#f74c00" rx="12" ry="18" />
        <ellipse cx="23" cy="33" fill="none" rx="7" ry="12" stroke="#ffb27a" strokeWidth="1.5" />
      </g>
    </svg>
  )
}

/**
 * One claw, drawn for the right side and mirrored for the left. The pincer is a rounded palm with a
 * large fixed finger on the outside and a hinged finger on the inside; their pointed tips meet.
 */
function Claw({ side }: { side: "left" | "right" }) {
  return (
    <g data-claw={side}>
      <path className="ferris-playground__leg" d={ARM_PATH} />
      <g transform="translate(17 -27) rotate(10)">
        <path
          className="ferris-playground__shell"
          d="M-2 -8 C1 -16 3 -25 6 -34 C13 -25 14 -13 10 -5 Z"
        />
        <g data-jaw={side}>
          <path
            className="ferris-playground__shell"
            d="M-9 -5 C-14 -14 -10 -26 1 -31 C-4 -25 -5 -15 -3 -7 Z"
          />
        </g>
        <path
          className="ferris-playground__shell"
          d="M-10 -3 C-11 7 -5 13 1 13 C8 13 12 6 10 -4 C8 -10 -8 -10 -10 -3 Z"
        />
        <path className="ferris-playground__shine" d="M-5 -2 C-4 -6 2 -7 5 -5" />
      </g>
    </g>
  )
}

function Ferris() {
  return (
    <svg
      aria-hidden="true"
      className="ferris-playground__crab-svg"
      viewBox={`${-CRAB_BOX.left} ${-CRAB_BOX.top} ${CRAB_BOX.width} ${CRAB_BOX.height}`}
    >
      <ellipse
        className="ferris-playground__shadow"
        cx="0"
        cy="-1"
        data-part="shadow"
        rx="46"
        ry="4.5"
      />
      <g data-part="body">
        {LEGS.map((leg, index) => (
          <path className="ferris-playground__leg" d={leg.path} data-leg={index} key={index} />
        ))}
        <path className="ferris-playground__shell" d={BODY_PATH} />
        <ellipse cx="0" cy="-25" fill="#c93a00" opacity="0.35" rx="32" ry="4.5" />
        <ellipse
          cx="-20"
          cy="-58"
          fill="#fff"
          opacity="0.2"
          rx="13"
          ry="5"
          transform="rotate(-22 -20 -58)"
        />
        <g className="ferris-playground__face">
          <ellipse className="ferris-playground__blush" cx="-29" cy="-33" rx="6" ry="3.5" />
          <ellipse className="ferris-playground__blush" cx="29" cy="-33" rx="6" ry="3.5" />
          <g className="ferris-playground__eyes-open" data-part="eyes">
            {[-13, 13].map((x) => (
              <g key={x}>
                <ellipse cx={x} cy="-45" fill="#1b1b1b" rx="6.5" ry="8.5" />
                <circle cx={x - 2} cy="-48.5" fill="#fff" r="2.4" />
                <circle cx={x + 2} cy="-42" fill="#fff" opacity="0.7" r="1.1" />
              </g>
            ))}
          </g>
          <g className="ferris-playground__eyes-happy">
            <path d="M-19 -44 q6 -8 12 0" />
            <path d="M7 -44 q6 -8 12 0" />
          </g>
          <g className="ferris-playground__eyes-sleep">
            <path d="M-19 -44 q6 5 12 0" />
            <path d="M7 -44 q6 5 12 0" />
          </g>
        </g>
      </g>
      <g data-part="claws">
        <g transform="translate(-44 -34) scale(-1 1)">
          <Claw side="left" />
        </g>
        <g transform="translate(44 -34)">
          <Claw side="right" />
        </g>
      </g>
    </svg>
  )
}

interface DragState {
  readonly cardId: number
  readonly pointerId: number
  samples: { t: number; x: number; y: number }[]
}

interface Parts {
  body: SVGGElement
  claws: SVGGElement
  clawLeft: SVGGElement
  clawRight: SVGGElement
  jawLeft: SVGGElement
  jawRight: SVGGElement
  eyes: SVGGElement
  legs: SVGPathElement[]
  shadow: SVGEllipseElement
}

function findParts(crab: HTMLElement): Parts | undefined {
  const query = <T extends Element>(selector: string) => crab.querySelector<T>(selector)
  const body = query<SVGGElement>('[data-part="body"]')
  const claws = query<SVGGElement>('[data-part="claws"]')
  const clawLeft = query<SVGGElement>('[data-claw="left"]')
  const clawRight = query<SVGGElement>('[data-claw="right"]')
  const jawLeft = query<SVGGElement>('[data-jaw="left"]')
  const jawRight = query<SVGGElement>('[data-jaw="right"]')
  const eyes = query<SVGGElement>('[data-part="eyes"]')
  const shadow = query<SVGEllipseElement>('[data-part="shadow"]')
  const legs = [...crab.querySelectorAll<SVGPathElement>("[data-leg]")]
  if (!body || !claws || !clawLeft || !clawRight || !jawLeft || !jawRight || !eyes || !shadow) {
    return undefined
  }
  return { body, clawLeft, clawRight, claws, eyes, jawLeft, jawRight, legs, shadow }
}

function mood(world: World) {
  const { crab } = world
  if (crab.plan.kind === "sleep") return "sleep"
  if (crab.happy > 0) return "happy"
  return crab.blink < 0 ? "blink" : "open"
}

/**
 * The post's hero: Ferris, the Rust mascot, playing with toy cards. Throw a card and Ferris
 * fetches it, click the floor to call Ferris over, or click Ferris for a pet. When the stage is
 * focused, the arrow keys walk, Shift runs, Space jumps, and Enter tosses a card.
 */
export function FerrisPlayground() {
  const stageRef = useRef<HTMLDivElement>(null)
  const crabRef = useRef<HTMLDivElement>(null)
  const bubbleRef = useRef<HTMLSpanElement>(null)
  const cardRefs = useRef(new Map<number, HTMLDivElement>())
  const particleRefs = useRef<(HTMLSpanElement | null)[]>([])
  const worldRef = useRef<World | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const keysRef = useRef({ left: false, right: false, run: false })

  useEffect(() => {
    const stage = stageRef.current
    const crabElement = crabRef.current
    const parts = crabElement ? findParts(crabElement) : undefined
    if (!stage || !crabElement || !parts) return

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const world = createWorld(
      stage.clientWidth,
      Math.random,
      reducedMotion.matches,
      cardCeiling(stage.clientHeight),
    )
    worldRef.current = world
    let height = stage.clientHeight
    let clawRaise = 0
    const shown = { mood: "", zIndex: new Map<number, string>(), face: new Map<number, string>() }
    const particleKinds: string[] = []

    const draw = () => {
      const { crab } = world
      const floor = height - FLOOR
      const speed = Math.min(1, Math.abs(crab.vx) / RUN_SPEED)
      const walking = Math.min(1, Math.abs(crab.vx) / WALK_SPEED)
      const airborne = crab.y > 0
      const breathing = world.calm ? 0 : Math.sin(world.time * 2.6) * 0.8
      const bob = airborne
        ? 0
        : Math.abs(Math.sin(crab.stride)) * (1.5 + 4 * speed) * walking + breathing
      const tilt = (crab.vx / RUN_SPEED) * 7

      crabElement.style.transform = `translate3d(${crab.x - CRAB_BOX.left}px, ${floor - crab.y - CRAB_BOX.top}px, 0)`
      parts.body.setAttribute(
        "transform",
        `translate(0 ${(-bob).toFixed(2)}) rotate(${tilt.toFixed(2)} 0 -40)`,
      )
      parts.claws.setAttribute(
        "transform",
        `translate(0 ${(-bob).toFixed(2)}) rotate(${tilt.toFixed(2)} 0 -40)`,
      )
      // The shadow stays on the floor and shrinks as Ferris jumps.
      const shadowScale = Math.max(0.45, 1 - crab.y / 260)
      parts.shadow.setAttribute(
        "transform",
        `translate(0 ${crab.y.toFixed(1)}) scale(${shadowScale.toFixed(3)})`,
      )
      parts.legs.forEach((element, index) => {
        const leg = LEGS[index]
        if (!leg) return
        const side = leg.x < 0 ? -1 : 1
        // On the floor a leg only lifts its tip and sets it down again; in the air the legs dangle.
        const lift =
          Math.max(0, Math.sin(crab.stride * 2 + leg.phase)) * (walking * 16 + speed * 12)
        const swing = airborne ? side * 14 : -side * lift
        element.setAttribute("transform", `rotate(${swing.toFixed(2)} ${leg.x} ${leg.y})`)
      })

      const holding = crab.held !== null || crab.plan.kind === "opening"
      const watching = crab.plan.kind === "watch"
      const targetRaise = holding
        ? 1
        : watching
          ? 0.55 + Math.sin(world.time * 12) * 0.2
          : crab.happy > 0
            ? 0.4
            : Math.sin(crab.stride) * 0.25 * speed
      clawRaise += (targetRaise - clawRaise) * 0.25
      const raise = (-clawRaise * 52).toFixed(2)
      parts.clawLeft.setAttribute("transform", `rotate(${raise})`)
      parts.clawRight.setAttribute("transform", `rotate(${raise})`)
      const snap = crab.snap > 0 ? Math.abs(Math.sin(((0.4 - crab.snap) / 0.4) * Math.PI * 3)) : 0
      const open = holding ? 0.05 : 0.3 + snap * 0.7
      const jaw = `rotate(${(-open * 24).toFixed(2)} -6 -6)`
      parts.jawLeft.setAttribute("transform", jaw)
      parts.jawRight.setAttribute("transform", jaw)
      parts.eyes.setAttribute(
        "transform",
        `translate(${(crab.lookX * 3).toFixed(2)} ${(-crab.lookY * 2.5).toFixed(2)})`,
      )
      const currentMood = mood(world)
      if (currentMood !== shown.mood) {
        crabElement.dataset["mood"] = currentMood
        shown.mood = currentMood
      }
      if (bubbleRef.current) bubbleRef.current.style.opacity = crab.alert > 0 ? "1" : "0"

      for (const card of world.cards) {
        const element = cardRefs.current.get(card.id)
        if (!element) continue
        const top = floor - card.y + card.lie * (6 + card.depth * 16)
        const scaleX = Math.max(0.06, Math.abs(Math.cos(card.flip)))
        const scaleY = 1 - 0.62 * card.lie
        element.style.transform = `translate3d(${(card.x - CARD_WIDTH / 2).toFixed(1)}px, ${(top - CARD_HEIGHT / 2).toFixed(1)}px, 0) rotate(${(card.angle * DEG).toFixed(1)}deg) scale(${scaleX.toFixed(3)}, ${scaleY.toFixed(3)})`
        const face = Math.cos(card.flip) < 0 ? "back" : "front"
        if (shown.face.get(card.id) !== face) {
          element.dataset["face"] = face
          shown.face.set(card.id, face)
        }
        const zIndex =
          card.holder === "crab" ? "1" : card.grounded ? (card.depth > 0.6 ? "3" : "1") : "4"
        if (shown.zIndex.get(card.id) !== zIndex) {
          element.style.zIndex = zIndex
          shown.zIndex.set(card.id, zIndex)
        }
      }

      particleRefs.current.forEach((element, index) => {
        if (!element) return
        const particle = world.particles[index]
        if (!particle) {
          if (particleKinds[index] !== "") {
            element.style.opacity = "0"
            particleKinds[index] = ""
          }
          return
        }
        if (particleKinds[index] !== particle.kind) {
          element.dataset["kind"] = particle.kind
          element.textContent = particle.kind === "z" ? "z" : ""
          particleKinds[index] = particle.kind
        }
        const progress = particle.age / particle.life
        const grow = particle.kind === "dust" ? 1 + progress : 1
        element.style.opacity = (1 - progress).toFixed(2)
        element.style.transform = `translate3d(${particle.x.toFixed(1)}px, ${(floor - particle.y).toFixed(1)}px, 0) translate(-50%, -50%) scale(${grow.toFixed(2)})`
        element.style.fontSize = `${particle.size}px`
        if (particle.kind === "dust") {
          element.style.width = `${particle.size}px`
          element.style.height = `${particle.size}px`
        }
      })
    }

    let frame = 0
    let last = 0
    let visible = false
    // On a direct page load the logo loading screen covers the page at first; hold the clock
    // until it is gone so the opening toss is not played behind it.
    let loaded = document.documentElement.dataset["loadingComplete"] === "true"
    const tick = (now: number) => {
      const dt = last === 0 ? 0 : Math.min((now - last) / 1000, 1 / 30)
      last = now
      if (dt > 0) step(world, dt)
      draw()
      frame = requestAnimationFrame(tick)
    }
    const start = () => {
      if (frame !== 0 || !loaded || !visible || document.hidden) return
      last = 0
      frame = requestAnimationFrame(tick)
    }
    const stop = () => {
      cancelAnimationFrame(frame)
      frame = 0
    }

    // Only animate while the hero is on screen and the tab is visible.
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false
      if (visible) start()
      else stop()
    })
    intersection.observe(stage)
    const visibility = () => (document.hidden ? stop() : start())
    document.addEventListener("visibilitychange", visibility)
    const loadingComplete = () => {
      loaded = true
      start()
    }
    if (!loaded) window.addEventListener(LOADING_COMPLETE_EVENT, loadingComplete, { once: true })
    const resize = new ResizeObserver(() => {
      height = stage.clientHeight
      resizeWorld(world, stage.clientWidth, cardCeiling(height))
      draw()
    })
    resize.observe(stage)
    const motion = () => {
      world.calm = reducedMotion.matches
    }
    reducedMotion.addEventListener("change", motion)

    draw()
    stage.dataset["ready"] = "true"
    return () => {
      stop()
      intersection.disconnect()
      resize.disconnect()
      document.removeEventListener("visibilitychange", visibility)
      window.removeEventListener(LOADING_COMPLETE_EVENT, loadingComplete)
      reducedMotion.removeEventListener("change", motion)
      worldRef.current = null
    }
  }, [])

  function worldPoint(event: ReactPointerEvent) {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: rect.height - FLOOR - (event.clientY - rect.top) }
  }

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const world = worldRef.current
    if (!world || event.button !== 0) return
    const point = worldPoint(event)
    const target = event.target as Element
    const card = target.closest<HTMLElement>("[data-card-id]")
    if (card) {
      const cardId = Number(card.dataset["cardId"])
      grabCard(world, cardId, point.x, point.y)
      dragRef.current = {
        cardId,
        pointerId: event.pointerId,
        samples: [{ t: event.timeStamp, ...point }],
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
      return
    }
    if (target.closest("[data-crab]")) petCrab(world)
    else callCrab(world, point.x)
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const world = worldRef.current
    if (!world) return
    const point = worldPoint(event)
    if (event.pointerType === "mouse" || dragRef.current) lookAt(world, point)
    const drag = dragRef.current
    if (drag?.pointerId !== event.pointerId) return
    dragCard(world, drag.cardId, point.x, point.y)
    drag.samples.push({ t: event.timeStamp, ...point })
    while (drag.samples.length > 2 && event.timeStamp - (drag.samples[0]?.t ?? 0) > 90) {
      drag.samples.shift()
    }
  }

  function pointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const world = worldRef.current
    const drag = dragRef.current
    if (!world || drag?.pointerId !== event.pointerId) return
    dragRef.current = null
    const first = drag.samples[0]
    const last = drag.samples.at(-1)
    const seconds = first && last ? (last.t - first.t) / 1000 : 0
    const velocity =
      first && last && seconds > 0.008
        ? { x: (last.x - first.x) / seconds, y: (last.y - first.y) / seconds }
        : { x: 0, y: 0 }
    releaseCard(world, drag.cardId, velocity.x, velocity.y)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (event.pointerType !== "mouse") lookAt(world, null)
  }

  function pointerLeave(event: ReactPointerEvent<HTMLDivElement>) {
    const world = worldRef.current
    if (world && !dragRef.current && event.pointerType === "mouse") lookAt(world, null)
  }

  function updateKeys(event: KeyboardEvent<HTMLDivElement>, down: boolean) {
    const world = worldRef.current
    if (!world) return false
    const keys = keysRef.current
    if (event.key === "ArrowLeft") keys.left = down
    else if (event.key === "ArrowRight") keys.right = down
    else if (event.key === "Shift") keys.run = down
    else return false
    keys.run = keys.run || event.shiftKey
    if (!down && event.key !== "Shift") keys.run = event.shiftKey
    setKeys(world, { ...keys })
    return true
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const world = worldRef.current
    if (!world) return
    if (updateKeys(event, true)) {
      event.preventDefault()
      return
    }
    if (event.key === " " || event.key === "ArrowUp") {
      event.preventDefault()
      jumpCrab(world)
    } else if (event.key === "Enter") {
      event.preventDefault()
      tossOrFetch(world)
    }
  }

  function keyUp(event: KeyboardEvent<HTMLDivElement>) {
    updateKeys(event, false)
  }

  function blur() {
    keysRef.current = { left: false, right: false, run: false }
    if (worldRef.current) setKeys(worldRef.current, keysRef.current)
  }

  return (
    <figure className="ferris-playground">
      <div
        aria-label="Ferris the crab playing with cards. Arrow keys walk, Shift runs, Space jumps, and Enter tosses a card."
        className="ferris-playground__stage"
        onBlur={blur}
        onKeyDown={keyDown}
        onKeyUp={keyUp}
        onPointerCancel={pointerUp}
        onPointerDown={pointerDown}
        onPointerLeave={pointerLeave}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        ref={stageRef}
        role="application"
        tabIndex={0}
      >
        <div className="ferris-playground__floor" />
        {CARD_IDS.map((id) => (
          <div
            className="ferris-playground__card"
            data-card-id={id}
            data-face="front"
            key={id}
            ref={(element) => {
              if (element) cardRefs.current.set(id, element)
              else cardRefs.current.delete(id)
            }}
          >
            <ToyCard />
          </div>
        ))}
        <div className="ferris-playground__crab" data-crab="" data-mood="open" ref={crabRef}>
          <span className="ferris-playground__bubble" ref={bubbleRef}>
            !
          </span>
          <Ferris />
        </div>
        {Array.from({ length: PARTICLE_SLOTS }, (_, index) => (
          <span
            aria-hidden="true"
            className="ferris-playground__particle"
            key={index}
            ref={(element) => {
              particleRefs.current[index] = element
            }}
          />
        ))}
      </div>
      <figcaption className="ferris-playground__hint">
        Throw a card and Ferris fetches it · click the floor to call Ferris · click Ferris for a pet
      </figcaption>
    </figure>
  )
}
