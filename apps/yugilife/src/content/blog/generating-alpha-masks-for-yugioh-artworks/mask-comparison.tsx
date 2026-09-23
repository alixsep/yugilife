import { useId, useState } from "react"

import { FIGURE_TYPE } from "@/components/data-visualization"
import { TabsSubtle, TabsSubtleItem, TabsSubtlePanel } from "@/components/ui/tabs-subtle"
import { cn } from "@/lib/utils"

import curved006 from "./assets/comparison/006-curved.webp"
import curvedAlpha006 from "./assets/comparison/006-curved-alpha.webp"
import original006 from "./assets/comparison/006-original.webp"
import rawSam3006 from "./assets/comparison/006-raw-sam3.webp"
import rawSam3Alpha006 from "./assets/comparison/006-raw-sam3-alpha.webp"
import sam2matting006 from "./assets/comparison/006-sam2matting.webp"
import sam2mattingAlpha006 from "./assets/comparison/006-sam2matting-alpha.webp"
import toonout006 from "./assets/comparison/006-toonout.webp"
import toonoutAlpha006 from "./assets/comparison/006-toonout-alpha.webp"
import curved010 from "./assets/comparison/010-curved.webp"
import curvedAlpha010 from "./assets/comparison/010-curved-alpha.webp"
import original010 from "./assets/comparison/010-original.webp"
import rawSam3010 from "./assets/comparison/010-raw-sam3.webp"
import rawSam3Alpha010 from "./assets/comparison/010-raw-sam3-alpha.webp"
import sam2matting010 from "./assets/comparison/010-sam2matting.webp"
import sam2mattingAlpha010 from "./assets/comparison/010-sam2matting-alpha.webp"
import toonout010 from "./assets/comparison/010-toonout.webp"
import toonoutAlpha010 from "./assets/comparison/010-toonout-alpha.webp"
import curved015 from "./assets/comparison/015-curved.webp"
import curvedAlpha015 from "./assets/comparison/015-curved-alpha.webp"
import original015 from "./assets/comparison/015-original.webp"
import rawSam3015 from "./assets/comparison/015-raw-sam3.webp"
import rawSam3Alpha015 from "./assets/comparison/015-raw-sam3-alpha.webp"
import sam2matting015 from "./assets/comparison/015-sam2matting.webp"
import sam2mattingAlpha015 from "./assets/comparison/015-sam2matting-alpha.webp"
import toonout015 from "./assets/comparison/015-toonout.webp"
import toonoutAlpha015 from "./assets/comparison/015-toonout-alpha.webp"
import curved021 from "./assets/comparison/021-curved.webp"
import curvedAlpha021 from "./assets/comparison/021-curved-alpha.webp"
import original021 from "./assets/comparison/021-original.webp"
import rawSam3021 from "./assets/comparison/021-raw-sam3.webp"
import rawSam3Alpha021 from "./assets/comparison/021-raw-sam3-alpha.webp"
import sam2matting021 from "./assets/comparison/021-sam2matting.webp"
import sam2mattingAlpha021 from "./assets/comparison/021-sam2matting-alpha.webp"
import toonout021 from "./assets/comparison/021-toonout.webp"
import toonoutAlpha021 from "./assets/comparison/021-toonout-alpha.webp"

/**
 * The four artworks every mode below is shown against, in a fixed order. Not a random sample: each
 * fails differently, so one mode switch shows a discarded aura, a total collapse, a clean result
 * and a busy composition at once. Portrait crops share the first row, squares the second.
 *
 * The 1px dilation rings are deliberately not among the modes: they change ~0.4% of pixels by at
 * most 0.15 alpha, which at this size is the same picture twice. What they did is in the prose.
 */
const ARTWORKS = [
  "Endymion, the Mighty Master of Magic",
  "Odd-Eyes Rebellion Dragon",
  "Infinite Impermanence",
  "The Arrival Cyberse @Ignister",
] as const

/**
 * What to show, on the right. The untouched artwork belongs here rather than among the methods: it
 * is not a way of masking anything, it is what every method was applied to.
 */
const VIEWS = [
  { id: "original", label: "Original" },
  { id: "cutout", label: "Cutout" },
  { id: "alpha", label: "Alpha mask" },
] as const

/** The view the figure opens on: a result, with the original one tab away. */
const DEFAULT_VIEW = 1

interface ComparisonMode {
  readonly id: string
  readonly label: string
  /** The artwork with the mask applied. One entry per ARTWORKS, in the same order. */
  readonly cutouts: readonly string[]
  /** The mask itself, as grayscale coverage. White is kept, black is removed. */
  readonly alphas?: readonly string[]
}

/**
 * A checkerboard behind every cutout. Transparency is the entire subject of this post, so a plain
 * surface would hide exactly the difference the figure exists to show — a kept background and a
 * correct cutout look identical against an opaque panel.
 */
const checkerboard = {
  backgroundImage:
    "linear-gradient(45deg, var(--muted) 25%, transparent 25%, transparent 75%, var(--muted) 75%), linear-gradient(45deg, var(--muted) 25%, transparent 25%, transparent 75%, var(--muted) 75%)",
  backgroundPosition: "0 0, 8px 8px",
  backgroundSize: "16px 16px",
}

/** No caption of its own: the tabs already name what is on screen. */
function ComparisonFigure({ modes }: { modes: readonly ComparisonMode[] }) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [viewIndex, setViewIndex] = useState(DEFAULT_VIEW)
  const idPrefix = useId().replaceAll(":", "")

  const showOriginal = VIEWS[viewIndex]?.id === "original"
  const showAlpha = VIEWS[viewIndex]?.id === "alpha"

  return (
    <figure>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <TabsSubtle
          aria-label="Masking method"
          idPrefix={idPrefix}
          onSelect={setSelectedIndex}
          selectedIndex={selectedIndex}
          size="compact"
        >
          {modes.map((mode, index) => (
            <TabsSubtleItem
              className={FIGURE_TYPE.table}
              index={index}
              key={mode.id}
              label={mode.label}
            />
          ))}
        </TabsSubtle>
        <TabsSubtle
          aria-label="What to show"
          onSelect={setViewIndex}
          selectedIndex={viewIndex}
          size="compact"
        >
          {VIEWS.map((view, index) => (
            <TabsSubtleItem
              className={FIGURE_TYPE.table}
              index={index}
              key={view.id}
              label={view.label}
            />
          ))}
        </TabsSubtle>
      </div>
      {modes.map((mode, index) => (
        <TabsSubtlePanel
          className="mt-4"
          idPrefix={idPrefix}
          index={index}
          key={mode.id}
          selectedIndex={selectedIndex}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {ARTWORKS.map((artwork, artworkIndex) => {
              const alpha = mode.alphas?.[artworkIndex]
              const source = showOriginal
                ? originals[artworkIndex]
                : showAlpha && alpha !== undefined
                  ? alpha
                  : mode.cutouts[artworkIndex]
              // Only a cutout needs the checkerboard: it is the one view where a kept background
              // and a removed one look alike against a plain surface.
              const transparent = !showOriginal && !(showAlpha && alpha !== undefined)
              return (
                <div
                  className={cn(
                    "border-border overflow-hidden rounded-lg border",
                    !transparent && "bg-muted",
                  )}
                  key={artwork}
                  style={transparent ? checkerboard : undefined}
                >
                  <img
                    // The article's shared image rules cap height at 70vh without an object fit,
                    // which distorts anything taller than it is wide. These are card artworks.
                    alt={
                      showOriginal
                        ? `${artwork}: the original artwork`
                        : `${artwork}: ${mode.label}, ${showAlpha && alpha !== undefined ? "alpha mask" : "cutout"}`
                    }
                    className="!my-0 !max-h-none !rounded-none !border-0"
                    loading="lazy"
                    src={source}
                  />
                </div>
              )
            })}
          </div>
        </TabsSubtlePanel>
      ))}
    </figure>
  )
}

const originals = [original006, original015, original010, original021] as const
const rawSam3 = [rawSam3006, rawSam3015, rawSam3010, rawSam3021] as const
const rawSam3Alphas = [rawSam3Alpha006, rawSam3Alpha015, rawSam3Alpha010, rawSam3Alpha021] as const
const curved = [curved006, curved015, curved010, curved021] as const
const curvedAlphas = [curvedAlpha006, curvedAlpha015, curvedAlpha010, curvedAlpha021] as const
const sam2matting = [sam2matting006, sam2matting015, sam2matting010, sam2matting021] as const
const sam2mattingAlphas = [
  sam2mattingAlpha006,
  sam2mattingAlpha015,
  sam2mattingAlpha010,
  sam2mattingAlpha021,
] as const
const toonout = [toonout006, toonout015, toonout010, toonout021] as const
const toonoutAlphas = [toonoutAlpha006, toonoutAlpha015, toonoutAlpha010, toonoutAlpha021] as const

export function Sam3Comparison() {
  return (
    <ComparisonFigure
      modes={[
        {
          alphas: rawSam3Alphas,
          cutouts: rawSam3,
          id: "raw-sam3",
          label: "Raw SAM3",
        },
        {
          alphas: curvedAlphas,
          cutouts: curved,
          id: "curved",
          label: "Low-alpha curve",
        },
        {
          alphas: sam2mattingAlphas,
          cutouts: sam2matting,
          id: "sam2matting",
          label: "SAM2Matting",
        },
      ]}
    />
  )
}

export function ToonOutComparison() {
  return (
    <ComparisonFigure
      modes={[
        {
          alphas: sam2mattingAlphas,
          cutouts: sam2matting,
          id: "best-sam3",
          label: "Best SAM3 attempt",
        },
        {
          alphas: toonoutAlphas,
          cutouts: toonout,
          id: "toonout",
          label: "ToonOut",
        },
      ]}
    />
  )
}
