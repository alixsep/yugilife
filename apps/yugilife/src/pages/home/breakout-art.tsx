import { useEffect } from "react"

import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion"

import { subscribeDeviceTilt } from "@/lib/device-tilt"

/** How far each layer travels at the edge of the pointer's reach, in px. */
const figureTravel = { x: 18, y: 12 }
const plateTravel = { x: -6, y: -4 }
const parallaxSpring = { damping: 24, mass: 0.6, stiffness: 120 }

const clamp = (value: number) => Math.min(1, Math.max(-1, value))

/**
 * An artwork whose subject steps out of its own frame: the full-art layout, shown as a layout.
 *
 * Two layers share one oversized square on the tile's centre: a clean plate, the background with
 * the subject painted out, cropped by a frame the size of the tile; and the subject's cutout,
 * outside the frame and uncropped, so wherever it reaches past the tile it is drawn over the
 * neighbours. Because the plate no longer contains the subject, the two can move independently: the
 * pointer, or the phone's tilt, shifts the subject further than the plate, which reads as depth.
 * Only transforms change, and reduced motion keeps both layers still.
 */
export function BreakoutArt({
  alt,
  figure,
  plate,
}: {
  alt: string
  figure: string
  plate: string
}) {
  const reducedMotion = useReducedMotion() ?? false
  const pointerX = useMotionValue(0)
  const pointerY = useMotionValue(0)
  const tiltX = useSpring(pointerX, parallaxSpring)
  const tiltY = useSpring(pointerY, parallaxSpring)
  const figureX = useTransform(tiltX, (value) => value * figureTravel.x)
  const figureY = useTransform(tiltY, (value) => value * figureTravel.y)
  const plateX = useTransform(tiltX, (value) => value * plateTravel.x)
  const plateY = useTransform(tiltY, (value) => value * plateTravel.y)

  useEffect(() => {
    if (reducedMotion) return
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return
      pointerX.set(clamp((event.clientX / window.innerWidth) * 2 - 1))
      pointerY.set(clamp((event.clientY / window.innerHeight) * 2 - 1))
    }
    const unsubscribeTilt = subscribeDeviceTilt((tilt) => {
      pointerX.set(clamp(tilt.x))
      pointerY.set(clamp(tilt.y))
    })
    window.addEventListener("pointermove", onPointerMove, { passive: true })
    return () => {
      unsubscribeTilt()
      window.removeEventListener("pointermove", onPointerMove)
    }
  }, [pointerX, pointerY, reducedMotion])

  return (
    <div className="bento-breakout">
      <div className="bento-breakout-frame">
        <motion.img
          alt={alt}
          className="bento-breakout-image bento-breakout-plate"
          draggable={false}
          src={plate}
          style={reducedMotion ? {} : { x: plateX, y: plateY }}
        />
      </div>
      <motion.img
        alt=""
        className="bento-breakout-image bento-breakout-figure"
        draggable={false}
        src={figure}
        style={reducedMotion ? {} : { x: figureX, y: figureY }}
      />
    </div>
  )
}
