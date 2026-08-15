import { lazy, Suspense, useEffect, useState } from "react"

import { ArrowUpRight } from "lucide-react"
import { Link } from "react-router"

import cardImage from "@/assets/landing/performapal-kuribohble.webp"
import { AppNavigation } from "@/components/app-navigation"
import { usePageTransitionReady } from "@/components/page-transition-ready"
import { AnimatedHeading } from "@/components/ui/animated-heading"
import { Button } from "@/components/ui/button"
import { WindMotion } from "@/components/ui/wind-motion"

const KuribohCanvas = lazy(() =>
  import("@/components/kuriboh-scene").then((module) => ({ default: module.KuribohCanvas })),
)

function LandingCanvas({ onReady }: { onReady: () => void }) {
  const placeholder = (
    <div aria-label="Loading interactive card scene" className="bg-card size-full" role="status" />
  )
  return (
    <Suspense fallback={placeholder}>
      <KuribohCanvas onReady={onReady} />
    </Suspense>
  )
}

function LandingCard() {
  return (
    <div className="border-border bg-card relative aspect-[813/1185] w-full shrink-0 overflow-hidden rounded-lg border">
      <WindMotion className="absolute inset-0 touch-manipulation">
        <img
          src={cardImage}
          alt="Performapal Kuribohble"
          className="landing-card-image pointer-events-none absolute top-1/2 left-1/2 h-[90%] w-[90%] object-contain select-none"
          draggable={false}
        />
      </WindMotion>
    </div>
  )
}

function BuildButton() {
  return (
    <Button
      asChild
      className="h-20 w-full shrink-0 text-2xl font-semibold sm:h-24 sm:text-3xl [&_svg]:size-6 sm:[&_svg]:size-7"
      trailingIcon={ArrowUpRight}
    >
      <Link to="/build">Go to Build</Link>
    </Button>
  )
}

function LandingCredits() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="text-muted-foreground w-full shrink-0 pt-2 pb-2 text-center">
      <p className="text-foreground text-sm font-semibold sm:text-base">
        Have a question or want to say hi?
      </p>
      <ul className="mt-4 grid grid-cols-4 gap-2">
        <li className="min-w-0">
          <a
            className="border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground flex aspect-square w-full items-center justify-center rounded-lg border p-1 text-[11px] font-medium transition-colors duration-80 sm:text-[12px]"
            href="mailto:alixsep@outlook.com"
          >
            Email
          </a>
        </li>
        <li className="min-w-0">
          <a
            className="border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground flex aspect-square w-full items-center justify-center rounded-lg border p-1 text-[11px] font-medium transition-colors duration-80 sm:text-[12px]"
            href="https://www.instagram.com/alixsepofficial/"
            rel="noreferrer"
            target="_blank"
          >
            Instagram
          </a>
        </li>
        <li className="min-w-0">
          <a
            className="border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground flex aspect-square w-full items-center justify-center rounded-lg border p-1 text-[11px] font-medium transition-colors duration-80 sm:text-[12px]"
            href="https://www.deviantart.com/alixsep"
            rel="noreferrer"
            target="_blank"
          >
            Deviantart
          </a>
        </li>
        <li className="min-w-0">
          <a
            className="border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground flex aspect-square w-full items-center justify-center rounded-lg border p-1 text-[11px] font-medium transition-colors duration-80 sm:text-[12px]"
            href="https://github.com/alixsep"
            rel="noreferrer"
            target="_blank"
          >
            Github
          </a>
        </li>
      </ul>
      <p className="text-muted-foreground mt-4 text-[11px] leading-4">
        © {currentYear} YUGILIFE · Developed by Alixsep
      </p>
    </footer>
  )
}

export function Home({ onReady = () => undefined }: { onReady?: () => void }) {
  const [canvasReady, setCanvasReady] = useState(false)
  const [cardImageReady, setCardImageReady] = useState(false)
  const landingReady = canvasReady && cardImageReady

  usePageTransitionReady(landingReady)

  useEffect(() => {
    const image = new Image()
    let cancelled = false
    image.src = cardImage
    const markReady = () => {
      if (!cancelled) setCardImageReady(true)
    }
    if (typeof image.decode === "function") {
      void image.decode().then(markReady, markReady)
    } else if (image.complete) markReady()
    else {
      image.addEventListener("load", markReady, { once: true })
      image.addEventListener("error", markReady, { once: true })
    }
    return () => {
      cancelled = true
      image.removeEventListener("load", markReady)
      image.removeEventListener("error", markReady)
    }
  }, [])

  useEffect(() => {
    if (landingReady) onReady()
  }, [landingReady, onReady])

  return (
    <main className="landing-page bg-background text-foreground flex min-h-dvh flex-col">
      <AppNavigation />

      <section className="landing-stage mx-auto flex min-h-0 w-full max-w-[1920px] flex-none flex-col items-start gap-3 p-3 pt-0 sm:gap-4 sm:p-4 sm:pt-0 lg:flex-row lg:gap-4">
        <div className="landing-scroll-left flex w-full min-w-0 flex-col gap-4 lg:h-full lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
          <div className="shrink-0 space-y-1">
            <AnimatedHeading
              lines={["Create", "high quality", "Yu-Gi-Oh!", "cards!"]}
              reveal={landingReady}
            />
          </div>
          <LandingCard />
          <BuildButton />
          <LandingCredits />
        </div>
        <div className="landing-canvas-slot order-first flex aspect-square h-[calc(100vw_-_1.5rem)] w-full min-w-0 place-self-start sm:h-[calc(100vw_-_2rem)] lg:order-2 lg:h-[min(calc(100dvh_-_4rem),60vw,calc(1920px_-_2rem))] lg:w-[min(calc(100dvh_-_4rem),60vw,calc(1920px_-_2rem))] lg:shrink-0">
          <div className="border-border bg-card size-full overflow-hidden rounded-lg border">
            <LandingCanvas onReady={() => setCanvasReady(true)} />
          </div>
        </div>
      </section>
    </main>
  )
}
