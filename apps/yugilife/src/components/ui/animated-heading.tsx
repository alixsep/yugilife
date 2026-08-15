import { useEffect, useId, useState } from "react"

import { motion, useReducedMotion } from "framer-motion"

import { WindMotion } from "@/components/ui/wind-motion"
import { LOADING_COMPLETE_EVENT } from "@/lib/loading-screen-event"

type AnimatedHeadingProps = {
  lines: readonly string[]
  className?: string
  reveal?: boolean
}

const headingVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      delayChildren: 0.18,
      staggerChildren: 0.2,
    },
  },
}

const lineVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.14,
    },
  },
}

const wordVariants = {
  hidden: { filter: "blur(12px)", opacity: 0, rotate: -5, y: "115%" },
  visible: {
    filter: "blur(0px)",
    opacity: 1,
    rotate: 0,
    y: 0,
    transition: {
      duration: 0.74,
      ease: [0.22, 1, 0.36, 1] as const,
    },
  },
}

export function AnimatedHeading({ lines, className, reveal }: AnimatedHeadingProps) {
  const prefersReducedMotion = useReducedMotion() === true
  const [hasLoaded, setHasLoaded] = useState(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.dataset.loadingComplete === "true",
  )
  const isRevealed = reveal ?? hasLoaded
  const gradientId = useId().replace(/:/g, "")
  const activeWordVariants = prefersReducedMotion
    ? {
        hidden: { filter: "blur(0px)", opacity: 1, rotate: 0, y: 0 },
        visible: { filter: "blur(0px)", opacity: 1, rotate: 0, y: 0, transition: { duration: 0 } },
      }
    : wordVariants
  const primaryWave =
    "M-32 336C56 298 88 118 208 148C334 180 334 350 458 306C528 282 568 220 676 230"
  const primaryWaveAlt =
    "M-32 336C56 320 88 142 208 162C334 194 334 332 458 294C528 270 568 236 676 246"
  const secondaryWave =
    "M-24 364C98 326 120 182 220 196C322 210 346 338 448 304C523 280 562 226 662 236"
  const secondaryWaveAlt =
    "M-24 364C98 342 120 202 220 212C322 224 346 316 448 288C523 264 562 242 662 250"
  const accentWave = "M48 312C92 280 126 278 168 294"
  const accentWaveAlt = "M48 312C92 296 126 300 168 286"
  const waveTransition = prefersReducedMotion
    ? { duration: 0 }
    : {
        d: { duration: 4.8, ease: "easeInOut", repeat: Infinity },
        opacity: { duration: 1.1, ease: "easeOut" },
        pathLength: { duration: 1.1, ease: "easeOut" },
      }

  useEffect(() => {
    if (reveal !== undefined || hasLoaded) return

    const revealHeading = () => setHasLoaded(true)
    window.addEventListener(LOADING_COMPLETE_EVENT, revealHeading)
    return () => window.removeEventListener(LOADING_COMPLETE_EVENT, revealHeading)
  }, [hasLoaded, reveal])

  return (
    <motion.section
      aria-labelledby={`${gradientId}-heading`}
      animate={isRevealed ? "visible" : "hidden"}
      className={`@container relative isolate flex min-h-0 w-full items-center justify-center overflow-hidden py-4 text-center sm:py-6 ${className ?? ""}`}
      initial="hidden"
      variants={headingVariants}
    >
      <motion.svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full text-(--focus-ring)"
        fill="none"
        preserveAspectRatio="none"
        viewBox="0 0 640 420"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient
            id={gradientId}
            x1="80"
            y1="48"
            x2="540"
            y2="360"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="currentColor" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0.18" />
          </linearGradient>
        </defs>

        <motion.path
          animate={
            isRevealed
              ? prefersReducedMotion
                ? { opacity: 0.84, pathLength: 1 }
                : { d: [primaryWave, primaryWaveAlt, primaryWave], opacity: 0.84, pathLength: 1 }
              : { opacity: 0, pathLength: 0 }
          }
          d={primaryWave}
          initial={{ opacity: 0, pathLength: 0 }}
          stroke={`url(#${gradientId})`}
          strokeLinecap="round"
          strokeWidth="3"
          transition={waveTransition}
        />
        <motion.path
          animate={
            isRevealed
              ? prefersReducedMotion
                ? { opacity: 0.38, pathLength: 1 }
                : {
                    d: [secondaryWave, secondaryWaveAlt, secondaryWave],
                    opacity: 0.38,
                    pathLength: 1,
                  }
              : { opacity: 0, pathLength: 0 }
          }
          d={secondaryWave}
          initial={{ opacity: 0, pathLength: 0 }}
          stroke="currentColor"
          strokeDasharray="5 10"
          strokeOpacity="0.38"
          strokeWidth="1.25"
          transition={waveTransition}
        />
        <motion.path
          animate={
            isRevealed
              ? prefersReducedMotion
                ? { opacity: 0.42, pathLength: 1 }
                : { d: [accentWave, accentWaveAlt, accentWave], opacity: 0.42, pathLength: 1 }
              : { opacity: 0, pathLength: 0 }
          }
          d={accentWave}
          initial={{ opacity: 0, pathLength: 0 }}
          stroke="currentColor"
          strokeLinecap="round"
          strokeOpacity="0.42"
          strokeWidth="1.5"
          transition={waveTransition}
        />
      </motion.svg>

      <motion.h1
        id={`${gradientId}-heading`}
        aria-label={lines.join(" ")}
        className="relative z-10 flex max-w-none flex-col leading-none"
        variants={headingVariants}
      >
        {lines.map((line, index) => (
          <WindMotion
            as="span"
            aria-hidden="true"
            className={`flex items-center justify-center gap-[0.18em] text-[clamp(2.35rem,13cqw,8rem)] leading-[1] font-semibold tracking-[-0.09em] whitespace-nowrap ${index === 1 ? "mb-[0.2em]" : index < lines.length - 1 ? "mb-[0.08em]" : ""}`}
            style={{
              rotate: index % 2 === 0 ? "-1.2deg" : "0.8deg",
              transformOrigin: "left bottom",
            }}
            key={`${line}-${index}`}
          >
            <motion.span className="contents" variants={lineVariants}>
              {line === "Yu-Gi-Oh!" ? (
                <motion.span
                  aria-label="Yu-Gi-Oh!"
                  className="inline-block rounded-[0.24em] bg-(--focus-ring) px-[0.18em] py-[0.08em] leading-[0.9] whitespace-nowrap text-(--background) will-change-[filter,opacity,transform]"
                  variants={activeWordVariants}
                >
                  Yu-Gi-Oh!
                </motion.span>
              ) : (
                line.split(/\s+/).map((word, wordIndex) => (
                  <motion.span
                    className="inline-block will-change-[filter,opacity,transform]"
                    key={`${word}-${wordIndex}`}
                    variants={activeWordVariants}
                  >
                    {word}
                  </motion.span>
                ))
              )}
            </motion.span>
          </WindMotion>
        ))}
      </motion.h1>
    </motion.section>
  )
}
