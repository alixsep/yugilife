import { forwardRef, useEffect, useMemo, useRef, useState } from "react"

import * as DialogPrimitive from "@radix-ui/react-dialog"
import { motion, useReducedMotion } from "framer-motion"
import { Check, Copy, Mail, MessageCircle, QrCode, Send, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { fontWeights } from "@/lib/font-weight"
import { cn } from "@/lib/utils"

import { donateContacts, donateCopy } from "./donate-contacts"
import { donateSpring } from "./motion"
import { encodeQr, qrPath, qrVersionFor } from "./qr-code"

import type { DonateContact } from "./donate-contacts"
import type { IconComponent } from "@/lib/icon-context"
import type { CSSProperties, HTMLAttributes, ReactNode } from "react"

const icons: Record<DonateContact["id"], IconComponent> = {
  discord: MessageCircle,
  email: Mail,
  telegram: Send,
}

const COPIED_FOR_MS = 1600
const QR_REGION_ID = "donate-qr-codes"

/** The one place in the app that is not the app: its own palette, in every theme. */
const palette = {
  "--donate-crimson": "#e11d48",
  "--donate-deep": "#6b0f2a",
  "--donate-ink": "#9f1239",
  /** Dark enough to hold 4.5:1 against the palest part of the fog, which the old rose did not. */
  "--donate-muted": "#7d4152",
  "--donate-rule": "rgba(159, 18, 57, 0.16)",
  /** A rule that has to be seen rather than felt — the close button's edge. */
  "--donate-edge": "rgba(159, 18, 57, 0.34)",
  /** The only surface on the screen: what a hover puts under a control. */
  "--donate-wash": "rgba(255, 255, 255, 0.58)",
} as CSSProperties

/**
 * Both kinds of button are the app's own, retinted by redefining the tokens each variant reads,
 * so they keep its size ladder, shape, press behaviour and focus handling. Nothing here is filled:
 * the contacts are meant to be found once the words have been read, not to compete with them, so
 * they carry no surface until a pointer is on them.
 */
const quietButton = cn(
  "text-(--donate-ink)",
  "[--active:rgba(255,255,255,0.86)] [--focus-ring:var(--donate-crimson)]",
  "[--hover:var(--donate-wash)]",
)
/**
 * The way out sits in the corner of the screen rather than under the plea: at the foot it was the
 * last thing read and read as the conclusion, which is the opposite of what this screen asks for.
 * Pink at rest so it is findable without being the first thing seen, crimson once it is aimed at.
 */
const closeButton = cn(
  // Pinned to the corner by one number, not two: `m-4` sets the distance to the top edge and to
  // the right edge from the same value, so the two can never drift apart in an edit. The box it
  // insets is a square (size icon = 36px) holding a glyph that is symmetric about both axes, so
  // the gap you see is the gap that is set.
  "fixed top-0 right-0 z-[2] m-4",
  "text-[#ec4899] hover:text-(--donate-crimson) [--focus-ring:var(--donate-crimson)]",
)

const iconButton = cn(
  "grid size-6 shrink-0 cursor-pointer place-items-center rounded-full",
  "text-(--donate-muted) hover:bg-(--donate-wash) hover:text-(--donate-deep)",
  "transition-colors duration-150 motion-reduce:transition-none",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e11d48]",
)

/** One of the three kinds of help, marked so it is findable without reading the sentence. */
function Mark({ children }: { children: ReactNode }) {
  return (
    <strong
      className="text-(--donate-deep) underline decoration-[rgba(225,29,72,0.42)] decoration-2 underline-offset-[5px]"
      style={{ fontVariationSettings: fontWeights.bold }}
    >
      {children}
    </strong>
  )
}

const rowShell = cn(
  "flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-3",
  "transition-colors duration-150 motion-reduce:transition-none",
)

/** The row's line, as a link when the contact has one and as plain text when it does not. */
function RowBody({ children, contact }: { children: ReactNode; contact: DonateContact }) {
  if (!contact.href) return <div className={rowShell}>{children}</div>
  return (
    <a
      href={contact.href}
      target={contact.id === "email" ? undefined : "_blank"}
      rel="noreferrer"
      className={cn(
        rowShell,
        "no-underline hover:bg-(--donate-wash)",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e11d48]",
      )}
    >
      {children}
    </a>
  )
}

function QrImage({ contact, version }: { contact: DonateContact; version: number }) {
  const encoded = contact.href ?? contact.handle
  const matrix = useMemo(() => encodeQr(encoded, version), [encoded, version])
  const extent = matrix.size + 8
  return (
    // Three squares of noise are indistinguishable from one another, so each one is named under
    // itself rather than only by the order it shares with the rows above.
    <motion.figure
      // will-change promotes each code to its own compositor layer, which is the whole reason the
      // reveal stays smooth. The fold above animates the height of an overflow-hidden box, so the
      // clip over this content changes every frame; unpromoted, that re-rasterises the symbol —
      // 546 hard-edged subpaths, three times over — on each one. Promoted, it is rastered once
      // and the fold merely moves the clip across a finished texture.
      className="m-0 will-change-transform"
      // Opacity and offset only, never scale. A code is a grid of hard-edged modules drawn with
      // shapeRendering="crispEdges"; scaling it re-snaps every module to a different pixel each
      // frame, which shimmers rather than animates. Sliding it leaves the raster alone.
      variants={{
        hidden: { opacity: 0, y: -12 },
        shown: { opacity: 1, y: 0 },
      }}
      // The tile spring has bounce, which is right for the slide and wrong for the fade: a spring
      // overshoots, and opacity past 1 only clamps — a hold at full, not a flourish. The fade gets
      // a spring of its own that lands instead.
      transition={{ ...donateSpring.tile, opacity: donateSpring.fold }}
    >
      <svg
        role="img"
        aria-label={`QR code for ${contact.label}: ${encoded}`}
        viewBox={`0 0 ${extent} ${extent}`}
        shapeRendering="crispEdges"
        // Big enough to scan off the screen from a phone held at arm's length: it fills its
        // third of the column rather than sitting as a thumbnail in it. The padding is the
        // quiet zone the spec asks for, drawn as white inside the border.
        className="mx-auto block h-auto w-full rounded-xl border border-(--donate-rule) bg-white"
      >
        <rect width={extent} height={extent} fill="#fff" />
        <path d={qrPath(matrix)} fill="#9f1239" />
      </svg>
      <figcaption
        className="mt-2 text-center text-[13px] text-(--donate-deep)"
        style={{ fontVariationSettings: fontWeights.semibold }}
      >
        {contact.label}
      </figcaption>
    </motion.figure>
  )
}

/**
 * The plea inside the pink screen.
 *
 * Built to be read in one pass and in one order: what I am asking, why, what would help, and only
 * then how to reach me. The gap before the third line is deliberate — the title and the reason are
 * one thought and should be read as one, and the ask needs to arrive after a pause rather than as
 * a third stacked line.
 *
 * No panel holds it, and nothing on it is filled: a card would make it read as a form to be
 * dismissed, and a filled button would pull the eye before the words had been read. The codes are
 * behind a toggle for the same reason — they matter only to someone reaching for a second device,
 * and three dense squares sitting open cost the whole screen its quiet.
 *
 * Contact-first because a Lightning invoice is single-use and expires; it is sent in the
 * conversation that starts here.
 */
export const DonateSheet = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function DonateSheet({ className, style, ...props }, ref) {
    const [copied, setCopied] = useState<DonateContact["id"] | null>(null)
    const [showQr, setShowQr] = useState(false)
    const reduced = useReducedMotion()
    const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

    // One version for all three, so the codes read as a set instead of three different textures.
    const qrVersion = useMemo(
      () => Math.max(...donateContacts.map((c) => qrVersionFor(c.href ?? c.handle))),
      [],
    )

    useEffect(() => () => clearTimeout(copiedTimer.current), [])

    const copy = async (contact: DonateContact) => {
      try {
        await navigator.clipboard.writeText(contact.handle)
      } catch {
        return
      }
      clearTimeout(copiedTimer.current)
      setCopied(contact.id)
      copiedTimer.current = setTimeout(() => setCopied(null), COPIED_FOR_MS)
    }

    return (
      // Radix's Content lends this element its dialog role and labelling through these props.
      <div
        ref={ref}
        tabIndex={-1}
        {...props}
        style={{ ...palette, ...style }}
        className={cn(
          // Anchored to the top, never centred vertically. Centring a block that changes height
          // moves everything above the change: opening the codes added 219px, so re-centring
          // lifted the title and the whole plea 109px up the screen mid-read. Held at a fixed
          // offset instead, the reveal only ever grows downward and nothing already on screen
          // moves. The offset is what reads as centred for the closed plea, and it scrolls from
          // its top on a short phone rather than being cut off.
          // my-auto, not a centred parent: a tall plea on a short phone then scrolls from its top
          // instead of having it cut off.
          "relative z-[1] my-auto w-[min(34rem,100%)]",
          "text-center text-(--donate-ink) outline-none",
          "text-[14px] leading-relaxed",
          className,
        )}
      >
        <DialogPrimitive.Title
          className="m-0 text-[clamp(2.125rem,7.2vw,3.5rem)] leading-[1.02] tracking-[-0.032em] text-balance text-(--donate-deep)"
          style={{ fontVariationSettings: fontWeights.bold }}
        >
          {donateCopy.title}
        </DialogPrimitive.Title>
        <DialogPrimitive.Description
          className="mx-auto mt-4 text-[clamp(1rem,2.3vw,1.1875rem)] leading-relaxed"
          style={{ fontVariationSettings: fontWeights.medium }}
        >
          {/* The reason carries itself: its own line, bigger and crimson, inside the same sentence
              rather than boxed off into something that reads as a banner. Sized in em so it keeps
              its step above the surrounding text at every width the clamp lands on. */}
          <strong
            className="mb-9 block text-[1.3em] leading-snug text-(--donate-crimson)"
            style={{ fontVariationSettings: fontWeights.bold }}
          >
            {donateCopy.situation}
          </strong>
          {/* Its own block, so text-balance has inline content to balance: left as part of the
              paragraph's flow it inherited the rule but never applied, and the last line came out
              a two-word orphan. */}
          <span className="mx-auto block max-w-[30rem] text-balance">
            If you can help with <Mark>money</Mark>, <Mark>relocation</Mark>, or <Mark>work</Mark>,
            message me.
          </span>
        </DialogPrimitive.Description>

        {/* One line each: the platform on the left, the handle on the right, and a hairline
            between them as the only edge. The row carries no surface until a pointer is on it. */}
        <ul
          className="m-0 mt-8 list-none divide-y divide-[rgba(159,18,57,0.16)] p-0 text-left"
          aria-label="Ways to reach me"
        >
          {donateContacts.map((contact) => {
            const Icon = icons[contact.id]
            const isCopied = copied === contact.id
            return (
              <li key={contact.id} className="flex items-center gap-1">
                {/* A link where there is somewhere to go, plain text where there is not: Discord
                    has no profile URL for a username, and an anchor that 404s is worse than a
                    handle you can read and copy. The line looks the same either way. */}
                <RowBody contact={contact}>
                  <Icon
                    size={17}
                    strokeWidth={1.75}
                    aria-hidden
                    className="shrink-0 text-(--donate-crimson)"
                  />
                  <span
                    className="shrink-0 text-[14px] text-(--donate-deep)"
                    style={{ fontVariationSettings: fontWeights.semibold }}
                  >
                    {contact.label}
                  </span>
                  <span
                    className="ml-auto truncate text-[13px] text-(--donate-muted)"
                    title={contact.handle}
                  >
                    {contact.handle}
                  </span>
                </RowBody>
                <button
                  type="button"
                  data-copied={isCopied}
                  aria-label={isCopied ? `Copied ${contact.label}` : `Copy ${contact.label}`}
                  onClick={() => void copy(contact)}
                  className={cn(iconButton, "size-8", "data-[copied=true]:text-(--donate-crimson)")}
                >
                  {isCopied ? (
                    <Check size={14} strokeWidth={2.25} aria-hidden />
                  ) : (
                    <Copy size={14} strokeWidth={1.75} aria-hidden />
                  )}
                </button>
              </li>
            )
          })}
        </ul>

        <Button
          variant="ghost"
          size="compact"
          leadingIcon={QrCode}
          aria-expanded={showQr}
          aria-controls={QR_REGION_ID}
          onClick={() => setShowQr((shown) => !shown)}
          className={cn(quietButton, "mt-5 text-(--donate-muted) hover:text-(--donate-crimson)")}
        >
          {showQr ? "Hide QR codes" : "Show QR codes"}
        </Button>
        {/* Folded rather than mounted and unmounted: a row of codes appearing from nothing moves
            everything under it in one frame, and on a centred column that jump moves the plea
            itself. The outer grid animates its one track from 0fr to 1fr — the height the content
            wants, without anyone having to measure it — and the inner box clips what does not fit
            yet. Hidden, it is inert as well as invisible, so nothing in it can be tabbed into. */}
        <motion.div
          className="overflow-hidden"
          // initial={false}: on the first paint the fold is simply closed, with nothing to play.
          initial={false}
          animate={showQr ? "shown" : "hidden"}
          variants={{ hidden: { height: 0 }, shown: { height: "auto" } }}
          transition={reduced ? { duration: 0 } : donateSpring.fold}
        >
          <motion.div
            id={QR_REGION_ID}
            inert={!showQr}
            aria-hidden={!showQr}
            className="mt-4 grid grid-cols-3 gap-3"
            // The three do not arrive at once: opening deals them left to right behind the fold,
            // closing takes them back right to left, so the movement has a direction instead of a
            // single blink. Timings only — every value they animate is on the tile spring.
            variants={{
              hidden: {
                transition: reduced
                  ? { duration: 0 }
                  : { staggerChildren: donateSpring.stagger, staggerDirection: -1 },
              },
              shown: {
                transition: reduced
                  ? { duration: 0 }
                  : { delayChildren: donateSpring.stagger, staggerChildren: donateSpring.stagger },
              },
            }}
          >
            {donateContacts.map((contact) => (
              <QrImage key={contact.id} contact={contact} version={qrVersion} />
            ))}
          </motion.div>
        </motion.div>

        <p className="mx-auto mt-7 max-w-[30rem] text-[13px] text-balance text-(--donate-ink)">
          {donateCopy.note}
        </p>

        <DialogPrimitive.Close asChild>
          <Button variant="text" size="icon" aria-label="Close" className={closeButton}>
            <X strokeWidth={1.75} aria-hidden />
          </Button>
        </DialogPrimitive.Close>
      </div>
    )
  },
)
