import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react"

import { motion, useReducedMotion } from "framer-motion"

import { announceLoadingComplete } from "@/lib/loading-screen-event"
import { cn } from "@/lib/utils"

import { LogoMark, logoPath } from "./logo-mark"

const wipePaths = {
  filled: "M 0 0 V 1 Q .5 1 1 1 V 0 z",
  curve: "M 0 0 V .5 Q .5 0 1 .5 V 0 z",
  unfilled: "M 0 0 V 0 Q .5 0 1 0 V 0 z",
} as const

const fillWipePaths = {
  start: "M 0 1 H 1 Q 1 1 1 1 Q .5 1 0 1 z",
  curve: "M 0 1 H 1 Q 1 .45 1 .35 Q .5 .25 0 .35 z",
  end: "M 0 1 H 1 Q 1 0 1 0 Q .5 0 0 0 z",
} as const

const wordmark = "YUGILIFE".split("")
const pathNumberPattern = /-?\d*\.?\d+/g

function createPathInterpolator(from: string, to: string) {
  const fromNumbers = from.match(pathNumberPattern)?.map(Number) ?? []
  const toNumbers = to.match(pathNumberPattern)?.map(Number) ?? []

  return (progress: number) => {
    let numberIndex = 0

    return to.replace(pathNumberPattern, () => {
      const fromValue = fromNumbers[numberIndex] ?? 0
      const toValue = toNumbers[numberIndex] ?? fromValue
      numberIndex += 1
      return String(fromValue + (toValue - fromValue) * progress)
    })
  }
}

function easeInQuart(progress: number) {
  return progress ** 4
}

function easeOutQuart(progress: number) {
  return 1 - (1 - progress) ** 4
}

export function LogoLoadingScreen({
  onComplete,
  onPrepare,
  readyToExit = true,
}: {
  onComplete?: () => void
  onPrepare?: () => void
  readyToExit?: boolean
}) {
  const [introComplete, setIntroComplete] = useState(false)
  const [isVisible, setIsVisible] = useState(true)
  const isExiting = introComplete && readyToExit
  const prefersReducedMotion = useReducedMotion()
  const clipId = useId().replace(/:/g, "")
  const accentClipId = `${clipId}-accent`
  const fillClipId = `${clipId}-fill`
  const clipPathRef = useRef<SVGPathElement>(null)
  const accentClipPathRef = useRef<SVGPathElement>(null)
  const fillWipePathRef = useRef<SVGPathElement>(null)
  const completeLoading = useCallback(() => {
    setIsVisible(false)
    announceLoadingComplete()
    onComplete?.()
  }, [onComplete])

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const exitTimer = window.setTimeout(
      () => {
        onPrepare?.()
        setIntroComplete(true)
      },
      reducedMotion ? 260 : 2_050,
    )

    return () => window.clearTimeout(exitTimer)
  }, [onPrepare])

  useLayoutEffect(() => {
    if (!fillWipePathRef.current) return

    const path = fillWipePathRef.current
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const delay = 720
    const duration = 520
    const startedAt = performance.now() + delay
    const startToCurve = createPathInterpolator(fillWipePaths.start, fillWipePaths.curve)
    const curveToEnd = createPathInterpolator(fillWipePaths.curve, fillWipePaths.end)
    let frameId = 0
    let cancelled = false

    const frame = (now: number) => {
      if (cancelled) return

      if (reducedMotion) {
        path.setAttribute("d", fillWipePaths.end)
        return
      }

      const progress = Math.min(1, Math.max(0, (now - startedAt) / duration))
      const curveProgress = 0.55
      const d =
        progress < curveProgress
          ? startToCurve(easeOutQuart(progress / curveProgress))
          : curveToEnd(easeOutQuart((progress - curveProgress) / (1 - curveProgress)))

      path.setAttribute("d", d)

      if (progress >= 1) return
      frameId = window.requestAnimationFrame(frame)
    }

    path.setAttribute("d", reducedMotion ? fillWipePaths.end : fillWipePaths.start)
    frameId = window.requestAnimationFrame(frame)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frameId)
    }
  }, [])

  useLayoutEffect(() => {
    if (!isExiting || !clipPathRef.current || !accentClipPathRef.current) return

    const path = clipPathRef.current
    const accentPath = accentClipPathRef.current
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches

    if (reducedMotion) {
      const frameId = window.requestAnimationFrame(() => {
        completeLoading()
      })
      return () => window.cancelAnimationFrame(frameId)
    }

    const duration = 900
    const accentDelay = 140
    const startedAt = performance.now()
    const filledToCurve = createPathInterpolator(wipePaths.filled, wipePaths.curve)
    const curveToUnfilled = createPathInterpolator(wipePaths.curve, wipePaths.unfilled)
    let frameId = 0
    let cancelled = false

    path.setAttribute("d", wipePaths.filled)
    accentPath.setAttribute("d", wipePaths.filled)

    const frame = (now: number) => {
      if (cancelled) return

      const progress = Math.min(1, (now - startedAt) / duration)
      const accentProgress = Math.min(1, Math.max(0, (now - startedAt - accentDelay) / duration))
      const curveProgress = 0.24

      const getWipePath = (wipeProgress: number) =>
        wipeProgress < curveProgress
          ? filledToCurve(easeInQuart(wipeProgress / curveProgress))
          : curveToUnfilled(easeOutQuart((wipeProgress - curveProgress) / (1 - curveProgress)))

      path.setAttribute("d", getWipePath(progress))
      accentPath.setAttribute("d", getWipePath(accentProgress))

      if (accentProgress >= 1) {
        completeLoading()
        return
      }

      frameId = window.requestAnimationFrame(frame)
    }

    frameId = window.requestAnimationFrame(frame)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frameId)
    }
  }, [completeLoading, isExiting])

  if (!isVisible) return null

  return (
    <>
      <svg
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 h-dvh w-screen opacity-0"
        preserveAspectRatio="none"
        viewBox="0 0 1 1"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <clipPath id={clipId} clipPathUnits="objectBoundingBox">
            <path ref={clipPathRef} d={wipePaths.filled} />
          </clipPath>
          <clipPath id={accentClipId} clipPathUnits="objectBoundingBox">
            <path ref={accentClipPathRef} d={wipePaths.filled} />
          </clipPath>
          <clipPath id={fillClipId} clipPathUnits="objectBoundingBox">
            <path ref={fillWipePathRef} d={fillWipePaths.start} />
          </clipPath>
        </defs>
      </svg>

      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none fixed inset-0 z-99999 h-dvh w-screen bg-(--focus-ring)",
          isExiting && "will-change-[clip-path]",
        )}
        style={{ clipPath: `url(#${accentClipId})` }}
      />

      <div
        aria-label="Loading Yugilife"
        aria-live="polite"
        className={cn(
          "bg-background text-foreground fixed inset-0 z-100000 flex h-dvh w-screen items-center justify-center overflow-hidden",
          isExiting && "will-change-[clip-path]",
        )}
        role="status"
        style={{ clipPath: `url(#${clipId})` }}
      >
        <div className="flex translate-y-[-1vh] flex-col items-center gap-6">
          <div className="relative h-[min(14vw,96px)] w-[min(14vw,96px)] overflow-visible">
            <motion.svg
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
              viewBox="0 0 7.14375 7.14375"
              xmlns="http://www.w3.org/2000/svg"
            >
              <motion.path
                animate={{ opacity: 0.88, strokeWidth: 1.1 }}
                className="fill-none stroke-current"
                d={logoPath}
                initial={prefersReducedMotion ? false : { opacity: 0, strokeWidth: 0 }}
                strokeLinecap="square"
                strokeLinejoin="bevel"
                transition={{
                  delay: prefersReducedMotion ? 0 : 0.05,
                  duration: prefersReducedMotion ? 0 : 1.2,
                  ease: [0.76, 0, 0.24, 1],
                }}
                vectorEffect="non-scaling-stroke"
              />
            </motion.svg>

            <LogoMark
              className="pointer-events-none absolute inset-0 h-full w-full"
              pathClassName="fill-current"
              pathProps={{ clipPath: `url(#${fillClipId})` }}
            />
          </div>

          <div
            aria-label="Yugilife"
            className="flex min-h-5.5 items-center pl-[.42em] text-[15px] font-bold tracking-[.42em] whitespace-nowrap"
          >
            {wordmark.map((letter, index) => (
              <motion.span
                aria-hidden="true"
                className="inline-block will-change-[filter,opacity,transform]"
                initial={prefersReducedMotion ? false : { filter: "blur(10px)", opacity: 0, y: 18 }}
                animate={{ filter: "blur(0px)", opacity: 1, y: 0 }}
                key={`${letter}-${index}`}
                transition={{
                  delay: prefersReducedMotion ? 0 : 0.88 + index * 0.075,
                  duration: prefersReducedMotion ? 0 : 0.54,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                {letter}
              </motion.span>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
