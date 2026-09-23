import { cancelFrame, frame } from "framer-motion"

import { prefersReducedMotion } from "./motion"

/**
 * The background of the screen the heart opens into: a white sky settling into pink fog along a
 * U-shaped curve. The puffs are baked into two oversized sheets once, and the only per-frame work
 * is two drawImage calls onto a surface at most 256px on its long side, which CSS then blows up.
 * Fog has no edges, so nothing shows.
 */
export interface Fog {
  /** Sizes the fog to its canvas if needed and paints a frame before anything fades it up. */
  start(): void
  stop(): void
  dispose(): void
}

const FPS = 10
const SPRITE_COLORS: readonly (readonly [number, number, number])[] = [
  [246, 137, 185],
  [255, 191, 215],
  [239, 119, 172],
  [255, 248, 252],
  [255, 222, 236],
]

const noFog: Fog = { dispose() {}, start() {}, stop() {} }

export function createFog(canvas: HTMLCanvasElement): Fog {
  const context = canvas.getContext("2d", { alpha: false })
  if (!context) return noFog

  const background = document.createElement("canvas")
  const base = document.createElement("canvas")
  const veil = document.createElement("canvas")
  let width = 0
  let height = 0
  let ratio = 1
  let layers: HTMLCanvasElement[] = []
  let running = false
  let lastDrawn = -1
  let sizedFor = ""

  let seed = 731
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 4294967296)
  const range = (from: number, to: number) => from + random() * (to - from)

  // each puff is a soft, internally textured volume, not a flat circle
  const sprites = SPRITE_COLORS.map(([r, g, b]) => {
    const texture = document.createElement("canvas")
    texture.width = texture.height = 256
    const paint = texture.getContext("2d")!
    for (let i = 0; i < 95; i++) {
      const angle = range(0, Math.PI * 2)
      const distance = Math.sqrt(random()) * 73
      const x = 128 + Math.cos(angle) * distance
      const y = 128 + Math.sin(angle) * distance
      const radius = range(20, 55)
      const light = range(0.97, 1.03)
      const rgb = `${Math.min(255, r * light)},${Math.min(255, g * light)},${Math.min(255, b * light)}`
      const gradient = paint.createRadialGradient(x, y, 0, x, y, radius)
      gradient.addColorStop(0, `rgba(${rgb},.12)`)
      gradient.addColorStop(0.4, `rgba(${rgb},.075)`)
      gradient.addColorStop(1, `rgba(${rgb},0)`)
      paint.fillStyle = gradient
      paint.fillRect(x - radius, y - radius, radius * 2, radius * 2)
    }
    return texture
  })

  function resize() {
    const rect = canvas.getBoundingClientRect()
    width = Math.max(1, Math.round(rect.width))
    height = Math.max(1, Math.round(rect.height))
    // fog has no sharp edges, so a small backing surface looks the same once enlarged, without
    // paying for millions of high-DPI pixels
    ratio = Math.min(1, 256 / Math.max(width, height))
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    context!.setTransform(ratio, 0, 0, ratio, 0, 0)

    // a curved colour field: the pink stands at the sides and dips in the centre
    background.width = background.height = 400
    const paint = background.getContext("2d")!
    const field = paint.createImageData(400, 400)
    for (let y = 0; y < 400; y++) {
      for (let x = 0; x < 400; x++) {
        const edge = Math.abs((x / 399) * 2 - 1) ** 2
        const depth = y / 399 + edge * 0.56
        const blend = Math.max(0, Math.min(1, (depth - 0.5) / 0.57))
        const smooth = blend * blend * (3 - 2 * blend)
        const offset = (y * 400 + x) * 4
        field.data[offset] = 255 - 9 * smooth
        field.data[offset + 1] = 255 - 111 * smooth
        field.data[offset + 2] = 255 - 65 * smooth
        field.data[offset + 3] = 255
      }
    }
    paint.putImageData(field, 0, 0)

    base.width = veil.width = canvas.width
    base.height = veil.height = canvas.height
    base.getContext("2d")!.drawImage(background, 0, 0, base.width, base.height)

    const skyPaint = veil.getContext("2d")!
    const sky = skyPaint.createLinearGradient(0, 0, 0, veil.height * 0.42)
    sky.addColorStop(0, "#fff")
    sky.addColorStop(0.3, "#fffffffa")
    sky.addColorStop(1, "#ffffff00")
    skyPaint.fillStyle = sky
    skyPaint.fillRect(0, 0, veil.width, veil.height * 0.42)
  }

  /** Bake the puffs into two oversized sheets; only the sheets move afterwards. */
  function populate() {
    layers = []
    seed = 827
    const scale = Math.max(width * 0.28, height * 0.35)
    for (let layer = 0; layer < 2; layer++) {
      const sheet = document.createElement("canvas")
      sheet.width = Math.ceil(canvas.width * 1.16)
      sheet.height = Math.ceil(canvas.height * 1.16)
      const paint = sheet.getContext("2d")!
      paint.setTransform(ratio, 0, 0, ratio, width * 0.08 * ratio, height * 0.08 * ratio)
      for (let i = 0; i < 48; i++) {
        const position = range(-0.18, 1.18)
        const edge = Math.abs(position * 2 - 1) ** 2
        const size = range(0.65, 1.45) * scale
        paint.save()
        paint.translate(position * width, (range(0.79, 1.18) - edge * 0.5) * height)
        paint.rotate(range(0, Math.PI * 2))
        paint.globalAlpha = range(0.15, 0.32)
        const sprite = sprites[Math.floor(range(0, sprites.length))]!
        paint.drawImage(sprite, -size / 2, -size / 2, size, size)
        paint.restore()
      }
      layers.push(sheet)
    }
  }

  function draw(elapsed: number) {
    context!.globalAlpha = 1
    context!.drawImage(base, 0, 0, width, height)
    layers.forEach((layer, i) => {
      const phase = elapsed * (0.48 + i * 0.085) + i * 2.1
      // counter-drifting sheets gently swell without additional draw calls
      const swell = 1.07 + (Math.sin(phase * 0.72) + 1) * 0.055
      const span = 1.16 * swell
      const x = width * ((1 - span) / 2 + Math.sin(phase) * 0.09)
      const y = height * ((1 - span) / 2 + Math.cos(phase * 0.8) * 0.07)
      context!.globalAlpha = 0.72 + Math.sin(phase * 0.7) * 0.27
      context!.drawImage(layer, x, y, width * span, height * span)
    })
    context!.globalAlpha = 1
    context!.drawImage(veil, 0, 0, width, height)
  }

  const tick = ({ timestamp }: { timestamp: number }) => {
    const elapsed = timestamp / 1000
    if (!running || prefersReducedMotion()) return // reduced motion gets one static frame
    if (elapsed - lastDrawn < 1 / FPS) return // sleep between updates
    lastDrawn = elapsed
    draw(elapsed)
  }

  function start() {
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0) return // still hidden; nothing to size to
    const key = `${Math.round(rect.width)}x${Math.round(rect.height)}`
    if (key !== sizedFor) {
      sizedFor = key
      resize()
      populate()
    }
    lastDrawn = -1
    draw(performance.now() / 1000) // painted before it is faded up
    if (!running) {
      running = true
      frame.update(tick, true)
    }
  }

  function stop() {
    running = false
    cancelFrame(tick)
  }

  const onResize = () => {
    if (running) start()
  }
  window.addEventListener("resize", onResize)

  return {
    dispose() {
      stop()
      window.removeEventListener("resize", onResize)
    },
    start,
    stop,
  }
}
