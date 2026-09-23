import { FIGURE_TYPE } from "@/components/data-visualization"
import { cn } from "@/lib/utils"

import artwork from "./assets/flute/artwork.webp"
import cutout from "./assets/flute/cutout.webp"
import fullArt from "./assets/flute/full-art.webp"
import mask from "./assets/flute/mask.webp"

/**
 * One card, from the artwork the pipeline is given to the card the app renders.
 *
 * The four pictures are the whole post in order: the source artwork, the alpha the model produced,
 * the foreground that alpha selects, and the full art render that consumes it. The tiles share one
 * aspect ratio so the square artworks and the portrait card sit in a real 2x2 grid rather than a
 * ragged one; the card very nearly fills its tile, and the artworks take a small letterbox.
 */
const STAGES = [
  { label: "The artwork", note: "original artwork, upscaled", src: artwork },
  { label: "The alpha", note: "what the finished pipeline produces", src: mask },
  { label: "The foreground", note: "the artwork with that alpha applied", src: cutout },
  { label: "The card", note: "full art, rendered from the two above", src: fullArt },
] as const

export function FullArtStages() {
  return (
    <figure>
      <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:gap-x-4">
        {STAGES.map((stage) => (
          <div key={stage.label}>
            {/* The notes take two lines on a narrow screen and one on a wide one; holding the pair
                to a fixed height keeps the four tiles on a shared grid either way. */}
            <div className="min-h-14 sm:min-h-10">
              <div className={cn(FIGURE_TYPE.label, "text-foreground font-medium")}>
                {stage.label}
              </div>
              <div className={cn(FIGURE_TYPE.note, "text-muted-foreground")}>{stage.note}</div>
            </div>
            <div className="border-border bg-muted mt-1.5 aspect-3/4 overflow-hidden rounded-lg border">
              <img
                // The article caps image height at 70vh with no object fit, and these four are not
                // the same shape, so the tile sets the box and the image is contained inside it.
                alt={`${stage.label}: ${stage.note}.`}
                className="!my-0 size-full !max-h-none !rounded-none !border-0 object-contain"
                loading="lazy"
                src={stage.src}
              />
            </div>
          </div>
        ))}
      </div>
      <figcaption>
        Breakdown of final results for the sample card "The Flute of Summoning Kuriboh".
      </figcaption>
    </figure>
  )
}
