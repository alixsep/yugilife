import { useEffect, useRef, useState } from "react"

import { Link } from "react-router"

import kuribohFigure from "@/assets/landing/kuriboh-figure.webp"
import kuribohPlate from "@/assets/landing/kuriboh-plate.webp"
import { AppNavigation } from "@/components/app-navigation"
import { usePageTransitionReady } from "@/components/page-transition-ready"
import { ReleaseFlag } from "@/components/release-flag"
import { useShape } from "@/lib/shape-context"

import { ArrowDisc } from "./arrow-disc"
import { useBorderGlow } from "./border-glow"
import { BreakoutArt } from "./breakout-art"
import { CountUp } from "./count-up"
import { FormatReel } from "./format-reel"

import type { CSSProperties } from "react"

import "./home.css"

const discordInvite = "https://discord.gg/cC4snQrtyM"
const githubProfile = "https://github.com/alixsep"

const contactLinks = [
  { href: "mailto:alixsep@outlook.com", label: "Email" },
  { href: "https://www.instagram.com/alixsepofficial/", label: "Instagram" },
  { href: "https://www.deviantart.com/alixsep", label: "Deviantart" },
  { href: githubProfile, label: "Github" },
] as const

/** The published catalog is the source of truth; this holds only until its manifest answers. */
const fallbackCardCount = 14_000
/** The page never waits longer than this on the manifest before it reveals. */
const countsWaitMs = 1500

function decodeImage(src: string) {
  const image = new Image()
  image.src = src
  return (typeof image.decode === "function" ? image.decode() : Promise.resolve()).catch(
    () => undefined,
  )
}

async function fetchCatalogCardCount(): Promise<number | undefined> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}card-catalog/manifest.json`, {
      cache: "no-cache",
    })
    if (!response.ok) return undefined
    const manifest = (await response.json()) as { catalog?: { recordCount?: unknown } }
    const cards = manifest.catalog?.recordCount
    return Number.isSafeInteger(cards) ? (cards as number) : undefined
  } catch {
    return undefined
  }
}

const order = (value: number) => ({ "--order": value }) as CSSProperties

/**
 * Discord's mark alone, drawn in the tile's own ink rather than the brand's blurple. The eyes are
 * drawn over a solid mark in the tile's surface colour, so they can close: a blink squashes them to
 * a slit, and a laugh swaps them for two happy arcs.
 */
function DiscordMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="currentColor" viewBox="36 110 440 300">
      <g className="bento-discord-body">
        <path d="m386 137c-24-11-49.5-19-76.3-23.7c-.5 0-1 0-1.2.6c-3.3 5.9-7 13.5-9.5 19.5c-29-4.3-57.5-4.3-85.7 0c-2.6-6.2-6.3-13.7-10-19.5c-.3-.4-.7-.7-1.2-.6c-23 4.6-52.4 13-76 23.7c-.2 0-.4.2-.5.4c-49 73-62 143-55 213c0 .3.2.7.5 1c32 23.6 63 38 93.6 47.3c.5 0 1 0 1.3-.4c7.2-9.8 13.6-20.2 19.2-31.2c.3-.6 0-1.4-.7-1.6c-10-4-20-8.6-29.3-14c-.7-.4-.8-1.5 0-2c2-1.5 4-3 5.8-4.5c.3-.3.8-.3 1.2-.2c61.4 28 128 28 188 0c.4-.2.9-.1 1.2.1c1.9 1.6 3.8 3.1 5.8 4.6c.7.5.6 1.6 0 2c-9.3 5.5-19 10-29.3 14c-.7.3-1 1-.6 1.7c5.6 11 12.1 21.3 19 31c.3.4.8.6 1.3.4c30.6-9.5 61.7-23.8 93.8-47.3c.3-.2.5-.5.5-1c7.8-80.9-13.1-151-55.4-213c0-.2-.3-.4-.5-.4Z" />
        <ellipse className="bento-discord-eye" cx="194" cy="270" rx="34" ry="38" />
        <ellipse className="bento-discord-eye" cx="319" cy="270" rx="34" ry="38" />
        <path
          className="bento-discord-laugh"
          d="M164 284Q194 244 224 284M289 284Q319 244 349 284"
          fill="none"
          strokeLinecap="round"
          strokeWidth="16"
        />
      </g>
    </svg>
  )
}

/**
 * The sparks the Discord mark throws when it spins: angle in degrees, reach in px, size in px, and a
 * lag in ms so they leave one after another rather than as a ring.
 */
const discordSparks = [
  [8, 34, 5, 0],
  [52, 28, 3, 60],
  [96, 36, 4, 20],
  [140, 30, 3, 90],
  [184, 38, 5, 40],
  [228, 27, 3, 110],
  [272, 35, 4, 10],
  [316, 31, 3, 70],
] as const

/** The spin's sparks, laid over the mark but outside it, so they fly out straight, unspun. */
function DiscordSparks() {
  return (
    <span aria-hidden="true" className="bento-discord-sparks">
      {discordSparks.map(([angle, reach, size, lag]) => {
        const radians = (angle * Math.PI) / 180
        return (
          <span
            key={angle}
            style={
              {
                "--spark-lag": `${lag}ms`,
                "--spark-size": `${size}px`,
                "--spark-x": `${(Math.cos(radians) * reach).toFixed(1)}px`,
                "--spark-y": `${(Math.sin(radians) * reach).toFixed(1)}px`,
              } as CSSProperties
            }
          />
        )
      })}
    </span>
  )
}

export function Home({ onReady = () => undefined }: { onReady?: () => void }) {
  const { bgRadius } = useShape()
  const [ready, setReady] = useState(false)
  const [cardCount, setCardCount] = useState(fallbackCardCount)
  const bentoRef = useRef<HTMLDivElement>(null)

  usePageTransitionReady(ready)
  // The pointer-lit tile borders. Off for now; pass `true` to bring them back.
  useBorderGlow(bentoRef, false)

  useEffect(() => {
    let cancelled = false
    const images = Promise.all([kuribohPlate, kuribohFigure].map(decodeImage))
    // The headline is set partly in the card-name typeface; revealing before it loads would show
    // the fallback serif for a frame and then swap.
    const typeface = document.fonts.load('1em "Matrix Small Caps"').catch(() => undefined)
    const catalog = Promise.race([
      fetchCatalogCardCount(),
      new Promise<undefined>((resolve) => window.setTimeout(resolve, countsWaitMs)),
    ])
    void Promise.all([images, typeface, catalog]).then(([, , published]) => {
      if (cancelled) return
      if (published !== undefined) setCardCount(published)
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (ready) onReady()
  }, [ready, onReady])

  // Tiles follow the app's shape preference: the pill setting gets deep, soft corners, the
  // rounded setting a tighter version of the same grid.
  const style = { "--bento-radius": bgRadius > 8 ? "28px" : "14px" } as CSSProperties

  return (
    <main
      className="landing-page bg-background text-foreground"
      data-landing-ready={ready ? "true" : "false"}
      style={style}
    >
      <AppNavigation />

      <div ref={bentoRef} className="bento">
        <section className="bento-tile bento-hero" style={order(0)}>
          <p className="bento-hero-lede text-muted-foreground">
            Free and open source.
            <br />
            Even Yugi Muto makes his cards here.
          </p>
          <h1 className="bento-headline">
            <span className="block">Create</span>
            <span className="block">high quality</span>
            <span className="block">
              <span className="bento-headline-card">Yu-Gi-Oh!</span> cards!
            </span>
          </h1>
        </section>

        <figure className="bento-cell bento-window" style={order(1)}>
          <BreakoutArt
            alt="Two Kuribohs and a pan flute, flying out of their frame over the tiles beside it."
            figure={kuribohFigure}
            plate={kuribohPlate}
          />
        </figure>

        <a
          className="bento-tile bento-link bento-discord"
          href={discordInvite}
          rel="noreferrer"
          style={order(2)}
          target="_blank"
        >
          <DiscordSparks />
          <DiscordMark className="bento-discord-mark" />
          <span className="bento-eyebrow text-muted-foreground">Community</span>
          <span className="bento-link-title">Join the Discord</span>
          <ArrowDisc />
        </a>

        <section className="bento-tile bento-stat bento-catalog" style={order(3)}>
          <p className="bento-eyebrow text-muted-foreground">Card catalog</p>
          <p className="bento-stat-value">
            <CountUp start={ready} value={cardCount} />
          </p>
          <p className="bento-stat-label text-muted-foreground">
            official cards. Pick one to fill in every field, including artwork.
          </p>
        </section>

        <section className="bento-tile bento-export" style={order(4)}>
          <p className="bento-eyebrow text-muted-foreground">Export</p>
          <FormatReel />
        </section>

        <Link className="bento-tile bento-link bento-blog" style={order(5)} to="/blog">
          <span className="bento-eyebrow text-muted-foreground">Blog</span>
          {/* The flag is the word "release", set inline so the title wraps around it as text. */}
          <span className="bento-link-title">
            <ReleaseFlag className="bento-title-flag" /> notes, behind the scenes, and more!
          </span>
          <ArrowDisc />
        </Link>

        <Link className="bento-tile bento-link bento-cta" style={order(6)} to="/build">
          <span className="bento-eyebrow">Card builder</span>
          <span className="bento-cta-title">Start building</span>
          <ArrowDisc className="bento-arrow-inverse" />
        </Link>

        <section className="bento-tile bento-hello" style={order(7)}>
          <p className="bento-eyebrow text-muted-foreground">Say hi</p>
          <ul className="bento-hello-links">
            {contactLinks.map(({ href, label }) => (
              <li key={href}>
                <a
                  href={href}
                  rel={href.startsWith("http") ? "noreferrer" : undefined}
                  target={href.startsWith("http") ? "_blank" : undefined}
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-auto">
            © {new Date().getFullYear()} Yugilife · Alixsep
          </p>
        </section>
      </div>
    </main>
  )
}
