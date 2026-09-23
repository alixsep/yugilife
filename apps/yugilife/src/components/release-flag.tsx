import { motion, useReducedMotion } from "framer-motion"

import type { Transition } from "framer-motion"

type ReleaseFlagProps = {
  label?: string
  className?: string
}

type Point = readonly [x: number, y: number]

const flagWidth = 70
const tailDepth = 8
const xCoordinates = [0, 8.75, 17.5, 26.25, 35, 43.75, 52.5, 61.25, flagWidth] as const
const sampleCount = 32
const phases = Array.from({ length: sampleCount + 1 }, (_, index) =>
  index === sampleCount ? 0 : (index / sampleCount) * Math.PI * 2,
)

function formatNumber(value: number) {
  return Number(value.toFixed(2))
}

// The hoist at x=0 never moves. The wave grows continuously toward the free
// edge, with enough spatial phase to read as traveling cloth rather than scale.
function getWaveOffset(x: number, phase: number) {
  const distanceFromHoist = x / flagWidth
  const amplitude = 3.6 * distanceFromHoist ** 1.15
  return amplitude * Math.sin(distanceFromHoist * Math.PI * 2.15 - phase)
}

function getWaveAngle(x: number, phase: number) {
  const sampleRadius = 0.5
  const rise =
    getWaveOffset(Math.min(flagWidth, x + sampleRadius), phase) -
    getWaveOffset(Math.max(0, x - sampleRadius), phase)
  return formatNumber((Math.atan2(rise, sampleRadius * 2) * 180) / Math.PI)
}

function wavePoint([x, y]: Point, phase: number): Point {
  return [x, formatNumber(y + getWaveOffset(x, phase))]
}

function curveThrough(points: readonly Point[], moveTo = true) {
  const first = points.at(0)
  if (!first) return ""

  let path = moveTo ? `M${first[0]} ${first[1]}` : ""
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)] ?? first
    const current = points[index] ?? first
    const next = points[index + 1] ?? current
    const following = points[Math.min(points.length - 1, index + 2)] ?? next
    const control1: Point = [
      formatNumber(current[0] + (next[0] - previous[0]) / 6),
      formatNumber(current[1] + (next[1] - previous[1]) / 6),
    ]
    const control2: Point = [
      formatNumber(next[0] - (following[0] - current[0]) / 6),
      formatNumber(next[1] - (following[1] - current[1]) / 6),
    ]
    path += `C${control1[0]} ${control1[1]} ${control2[0]} ${control2[1]} ${next[0]} ${next[1]}`
  }
  return path
}

function getFlagPath(phase: number) {
  const top = xCoordinates.map((x) => wavePoint([x, 4], phase))
  const bottom = xCoordinates.map((x) => wavePoint([x, 22], phase)).reverse()
  const notch = wavePoint([flagWidth - tailDepth, 13], phase)
  const bottomRight = bottom.at(0) ?? [flagWidth, 22]

  return `${curveThrough(top)}L${notch[0]} ${notch[1]}L${bottomRight[0]} ${bottomRight[1]}${curveThrough(bottom, false)}Z`
}

const flagFrames = phases.map(getFlagPath)
const restingFlag = flagFrames.at(0) ?? ""
const frameTimes = phases.map((_, index) => index / sampleCount)

function getLetterX(index: number, letterCount: number) {
  const spacing = 6.4
  const flagBodyCenter = (flagWidth - tailDepth) / 2
  return flagBodyCenter - ((letterCount - 1) * spacing) / 2 + index * spacing
}

function getLetterProjection(x: number, phase: number) {
  const angle = getWaveAngle(x, phase)
  const angleInRadians = (angle * Math.PI) / 180

  return {
    scaleX: formatNumber(Math.max(0.88, Math.cos(angleInRadians))),
    skewY: angle,
    y: formatNumber(getWaveOffset(x, phase)),
  }
}

export function ReleaseFlag({ label = "RELEASE", className }: ReleaseFlagProps) {
  const prefersReducedMotion = useReducedMotion() === true
  const flagLabel = label.toUpperCase()
  const letters = [...flagLabel]
  const waveTransition: Transition = prefersReducedMotion
    ? { duration: 0 }
    : {
        duration: 2.8,
        ease: "linear",
        repeat: Infinity,
        times: frameTimes,
      }

  return (
    <svg
      aria-label={flagLabel}
      className={`text-caption inline-block h-[2.1667em] w-[5.8333em] shrink-0 -rotate-2 ${className ?? ""}`}
      focusable="false"
      role="img"
      viewBox="0 0 70 26"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{flagLabel}</title>
      <motion.path
        animate={{ d: prefersReducedMotion ? restingFlag : flagFrames }}
        d={restingFlag}
        fill="var(--user-accent)"
        initial={false}
        transition={waveTransition}
      />
      {letters.map((letter, index) => {
        const x = getLetterX(index, letters.length)
        const projections = phases.map((phase) => getLetterProjection(x, phase))

        return (
          <motion.g
            // The position is stable even when the same letter occurs more than once.
            key={index}
            animate={{
              scaleX: prefersReducedMotion ? 1 : projections.map(({ scaleX }) => scaleX),
              skewY: prefersReducedMotion ? 0 : projections.map(({ skewY }) => skewY),
              y: prefersReducedMotion ? 0 : projections.map(({ y }) => y),
            }}
            initial={false}
            style={{ transformOrigin: `${x}px 13px` }}
            transition={waveTransition}
          >
            <text
              fill="var(--user-accent-foreground)"
              fontFamily="Geist Variable, Geist, system-ui, sans-serif"
              fontSize="11.5"
              fontWeight="500"
              textAnchor="middle"
              x={x}
              y="16.8"
            >
              {letter}
            </text>
          </motion.g>
        )
      })}
    </svg>
  )
}
