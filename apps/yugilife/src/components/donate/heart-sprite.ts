import { cancelFrame, frame } from "framer-motion"

import { heartMesh } from "./heart-mesh"
import { donateTiming, ease, finish, prefersReducedMotion, tween } from "./motion"

import type { AnimationHandle } from "./motion"
import type * as Three from "three"

/**
 * A 3D heart in a 28px canvas, flown around the page by a CSS transform. It is never resized and
 * never goes full-screen: crossing the whole viewport costs the same as sitting still.
 *
 * Every tween writes to a plain object and the frame callback draws whatever those objects say,
 * then places the canvas — one clock, no hand-overs.
 */
export interface HeartSprite {
  /** Hovered or focused: it lifts a little and starts to beat. */
  setActive(active: boolean): void
  /**
   * It swells to its native size and the weight takes it down. There is no toss: it does not rise
   * at all, it gathers speed all the way to the floor and breaks there. Resolves with the impact
   * point, which is where the light of the break comes from.
   */
  breakOnFloor(): Promise<readonly [x: number, y: number]>
  /** Coming back is not the fall rewound — that heart is gone. A new one drops in from above. */
  dropIn(): Promise<void>
  /** Back to a whole heart in its seat, whatever was happening. */
  reset(): void
  /** Hide it outright — another screen is up. */
  setVisible(visible: boolean): void
  dispose(): void
}

export interface HeartSpriteOptions {
  readonly canvas: HTMLCanvasElement
  /** The heart's seat in the button, in viewport coordinates; empty while the button is hidden. */
  readonly seat: () => DOMRect | undefined
}

const BOX_PX = 28 // the canvas, in CSS pixels
const BACKING_PX = 64 // ...and in device pixels: supersampled, then scaled down
const HEART_PX = 17 // how wide the heart itself sits in the button
const UNITS_PER_PX = 1 / 40
const HOVER_SCALE = 1.16
const TILT = -0.13 // a slight lean, so you read the dome as it turns
// Scaled this far the 64px buffer is displayed 1:1 rather than squeezed into 28 — the heart at
// its native resolution, about 39px across.
const NATIVE = BACKING_PX / BOX_PX

const clamp = (min: number, max: number, value: number) => Math.min(max, Math.max(min, value))

/** A real heartbeat is two thumps and a rest, not a sine wave. */
function heartbeat(seconds: number) {
  const phase = (seconds % donateTiming.beat) / donateTiming.beat
  const lub = Math.exp(-(((phase - 0.0) / 0.055) ** 2))
  const dub = Math.exp(-(((phase - 0.19) / 0.07) ** 2)) * 0.62
  return 1 + (lub + dub) * 0.17
}

function hasWebGL() {
  try {
    return Boolean(document.createElement("canvas").getContext("webgl"))
  } catch {
    return false
  }
}

/** Resolves to null where WebGL or three.js is missing; the caller shows a flat heart instead. */
export async function createHeartSprite({
  canvas,
  seat,
}: HeartSpriteOptions): Promise<HeartSprite | null> {
  if (!hasWebGL()) return null

  let THREE: typeof Three
  try {
    THREE = await import("three")
  } catch {
    return null
  }

  const geometry = (() => {
    const { data, tris, verts } = heartMesh
    const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0))
    const coords = new Int16Array(bytes.buffer, 0, verts * 3)
    const index = new Uint16Array(bytes.buffer, verts * 6, tris * 3)
    const positions = new Float32Array(coords.length)
    for (let i = 0; i < coords.length; i++) positions[i] = coords[i]! / 32767
    const result = new THREE.BufferGeometry()
    result.setAttribute("position", new THREE.BufferAttribute(positions, 3))
    result.setIndex(new THREE.BufferAttribute(index.slice(), 1))
    result.center()
    result.computeVertexNormals()
    result.computeBoundingBox()
    return result
  })()

  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffe0e9, // porcelain: lighter than the button under it
    roughness: 0.26,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.14, // a wet, candied surface
    sheen: 0.8,
    sheenColor: 0xffffff,
    emissive: 0xff4f76,
    emissiveIntensity: 0.1,
  })
  const mesh = new THREE.Mesh(geometry, material)
  const { max, min } = geometry.boundingBox!
  const baseScale = (HEART_PX * UNITS_PER_PX) / (max.x - min.x)

  const scene = new THREE.Scene()
  scene.add(mesh)
  scene.add(new THREE.AmbientLight(0xffc9d8, 0.75)) // tinted, so the shaded side goes rose
  const lights: [color: number, power: number, x: number, y: number, z: number][] = [
    [0xffffff, 3.1, -0.8, 1.2, 1.2], // key
    [0xff9ebc, 1.3, 1.1, -0.4, 0.85], // rose fill
    [0xff5a86, 0.85, 0.1, -1.0, -0.7], // rim, from below and behind
  ]
  for (const [color, power, x, y, z] of lights) {
    const light = new THREE.DirectionalLight(color, power)
    light.position.set(x, y, z)
    scene.add(light)
  }

  const half = (BOX_PX * UNITS_PER_PX) / 2
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 20)
  camera.position.z = 6

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, canvas })
  renderer.setPixelRatio(NATIVE)
  renderer.setSize(BOX_PX, BOX_PX, false)

  /* ---- what moves ----------------------------------------------------------------------------
     Tweens write to these; the frame callback reads them. Nothing else holds state. */
  const beat = { mix: 0 } // fades the heartbeat in with hover
  const view = { scale: 1 } // the hover lift
  const place = { dy: 0, scale: 1 } // offset from its seat, in CSS px
  const turn = { t: 0 } // the tumble of a falling heart
  const drop = { from: 0, t: 0 } // a replacement heart coming down
  const land = { t: 0 } // ...and settling
  let move: "rest" | "break" | "return" = "rest"
  let hiddenByHost = false
  let started = -1
  const handles = new Set<AnimationHandle>()
  let lift: AnimationHandle | undefined
  let pulse: AnimationHandle | undefined

  /** Every move starts from the resting pose and hands back to it, which is what keeps the seams
   *  invisible: the spin is never stopped or restarted, only ever added to. */
  const spinPhase = (seconds: number) =>
    ((seconds % donateTiming.spin) / donateTiming.spin) * Math.PI * 2
  const restRoll = (phase: number) => Math.sin(phase * 0.5) * 0.05
  const restScale = (seconds: number) =>
    baseScale * view.scale * (prefersReducedMotion() ? 1 : 1 + (heartbeat(seconds) - 1) * beat.mix)

  const centre = (rect: DOMRect) =>
    [rect.left + rect.width / 2, rect.top + rect.height / 2] as const
  const floorY = () => window.innerHeight - HEART_PX / 2 // its point touches the bottom edge

  function track(handle: AnimationHandle) {
    handles.add(handle)
    void handle.then(() => handles.delete(handle))
    return handle
  }

  /* ---- the frame -------------------------------------------------------------------------------
     Draws what the tweens currently say, then places the canvas. The offset is added to the seat's
     own position every frame, so the heart keeps tracking its button even mid-flight: scrolling
     cannot tear it loose. */
  const draw = ({ timestamp }: { timestamp: number }) => {
    if (started < 0) started = timestamp
    const seconds = (timestamp - started) / 1000
    const phase = spinPhase(seconds)
    const scale = restScale(seconds)

    if (move === "break") {
      // the tumble is slight — heavy things do not spin freely
      mesh.rotation.set(TILT, phase + 0.6 * turn.t, restRoll(phase) + 0.3 * turn.t)
      mesh.scale.setScalar(scale)
    } else if (move === "return") {
      if (drop.t < 1) {
        // the lean unwinds onto the idle spin, reaching exactly it at t = 1
        place.dy = drop.from * (1 - drop.t)
        mesh.rotation.set(TILT, phase - 0.9 * (1 - drop.t), restRoll(phase) + 0.55 * (1 - drop.t))
        mesh.scale.setScalar(scale)
      } else {
        // land, squash, settle
        const bounce = Math.sin(land.t * Math.PI) * (1 - land.t * 0.6)
        place.dy = -6 * bounce
        mesh.rotation.set(TILT, phase, restRoll(phase))
        mesh.scale.set(scale * (1 + 0.26 * bounce), scale * (1 - 0.22 * bounce), scale)
      }
    } else {
      mesh.rotation.set(TILT, phase, restRoll(phase))
      mesh.scale.setScalar(scale)
    }

    const rect = seat()
    // hidden if the host says so, or if its seat is off screen (don't park at 0,0)
    // It keeps drawing either way. Skipping the frames while it is hidden saves a layout read and
    // a WebGL draw, and costs the close: the context goes cold under the donate screen and its
    // first draw back lands on the frame the band starts sweeping, which is exactly where a hitch
    // is felt. A 64px buffer every frame is the cheaper half of that trade.
    const hidden = hiddenByHost || !rect || rect.width === 0
    canvas.style.visibility = hidden ? "hidden" : "visible"
    if (!hidden) {
      const [x, y] = centre(rect)
      // scaled about its centre, so growing does not shift where it sits
      canvas.style.transform = `translate3d(${x - BOX_PX / 2}px, ${y - BOX_PX / 2 + place.dy}px, 0) scale(${place.scale})`
    }
    renderer.render(scene, camera)
  }
  frame.render(draw, true)

  function settle() {
    lift?.stop()
    pulse?.stop()
    move = "rest"
    place.dy = 0
    place.scale = 1
    mesh.visible = true
    canvas.style.zIndex = "40"
  }

  return {
    setActive(active) {
      canvas.dataset.active = String(active)
      if (prefersReducedMotion()) return
      lift?.stop()
      pulse?.stop()
      lift = tween(view, "scale", active ? HOVER_SCALE : 1, {
        duration: active ? 0.16 : donateTiming.settle,
        ease: ease.power3Out,
      })
      pulse = tween(beat, "mix", active ? 1 : 0, { duration: active ? 0.16 : 0.27 })
    },

    async breakOnFloor() {
      const rect = seat()
      const [x, y] = rect ? centre(rect) : [window.innerWidth / 2, 0]
      const ground = floorY()
      if (prefersReducedMotion()) return [x, ground]

      // ease out of the hover pose rather than snapping to the rest size
      lift?.stop()
      pulse?.stop()
      pulse = tween(beat, "mix", 0, { duration: 0.13 })
      lift = tween(view, "scale", 1, { duration: 0.2, ease: ease.power2Out })
      canvas.style.zIndex = "50" // it falls in front of the incoming screen

      const distance = Math.max(1, ground - y)
      // Bounds and offset track donateTiming.fall, so the whole curve retimes as one.
      const flight = clamp(0.34, 0.66, Math.sqrt(distance / 260) * donateTiming.fall + 0.12)
      // Whatever the last fall left behind: it starts from its seat, at its seated size, again.
      place.dy = 0
      place.scale = 1
      turn.t = 0
      move = "break"

      // Weightier than t²: see ease.fallIn. Still at the top, and still gaining at the floor.
      await Promise.all([
        track(tween(place, "scale", NATIVE, { duration: donateTiming.swell, ease: ease.backOut })),
        track(
          tween(place, "dy", distance, {
            delay: donateTiming.swell * 0.55,
            duration: flight,
            ease: ease.fallIn,
          }),
        ),
        track(
          tween(turn, "t", 1, {
            duration: donateTiming.swell * 0.55 + flight,
            ease: "linear",
          }),
        ),
      ])
      move = "rest"
      mesh.visible = false // it does not survive the landing
      return [x, ground]
    },

    async dropIn() {
      const rect = seat()
      if (prefersReducedMotion() || !rect) {
        place.dy = 0
        return
      }
      const [, homeY] = centre(rect)
      mesh.visible = true
      canvas.style.zIndex = "40" // under the band, so the sweep uncovers it
      place.scale = 1 // an ordinary heart, not a heavy one
      drop.from = -(homeY + 40) // above the top edge
      drop.t = 0
      land.t = 0
      place.dy = drop.from // parked before anything can draw it
      move = "return"

      await track(
        tween(drop, "t", 1, {
          delay: donateTiming.backDelay,
          duration: donateTiming.back,
          ease: ease.power2In,
        }),
      )
      await track(tween(land, "t", 1, { duration: 0.2, ease: "linear" }))
      move = "rest" // ends on the rest pose exactly, offset back at zero: no hand-over at all
      place.dy = 0
    },

    reset() {
      finish(handles)
      handles.clear()
      settle()
    },

    setVisible(visible) {
      hiddenByHost = !visible
      canvas.style.visibility = visible ? "visible" : "hidden"
    },

    dispose() {
      cancelFrame(draw)
      finish(handles)
      handles.clear()
      lift?.stop()
      pulse?.stop()
      geometry.dispose()
      material.dispose()
      renderer.dispose()
    },
  }
}
