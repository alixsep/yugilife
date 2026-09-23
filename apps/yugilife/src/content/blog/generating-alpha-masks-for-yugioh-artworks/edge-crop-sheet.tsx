import { FIGURE_TYPE } from "@/components/data-visualization"
import { cn } from "@/lib/utils"

import artwork from "./assets/stages/artwork.webp"
import curvedAlpha from "./assets/stages/curved-alpha.webp"
import curvedCutout from "./assets/stages/curved-cutout.webp"
import hardAlpha from "./assets/stages/hard-alpha.webp"
import hardCutout from "./assets/stages/hard-cutout.webp"
import rawAlpha from "./assets/stages/raw-alpha.webp"
import rawCutout from "./assets/stages/raw-cutout.webp"
import sam2Alpha from "./assets/stages/sam2-alpha.webp"
import sam2Cutout from "./assets/stages/sam2-cutout.webp"
import softAlpha from "./assets/stages/soft-alpha.webp"
import softCutout from "./assets/stages/soft-cutout.webp"

/**
 * One edge region of one artwork, put through every stage of the SAM3 pipeline.
 *
 * A stage is a block — a label and its two pictures — and the blocks tile two-up, so a group is
 * never split across a row at either width. The region itself leads the grid at the same size as
 * every stage, so it can be compared against any of them without the eye changing scale; its left
 * tile is an empty slot rather than a picture, which keeps the left column alpha and the right
 * column picture on every row.
 *
 * ToonOut is deliberately excluded: this sheet is the refinement of one boundary, and a model that
 * never saw a phrase belongs to the question the next section asks. Same region as the close-up
 * figure, so the two can be read against each other.
 */
const STAGES = [
  {
    alpha: rawAlpha,
    cutout: rawCutout,
    label: "Raw SAM3",
    note: "the boundary the phrase produced",
  },
  {
    alpha: hardAlpha,
    cutout: hardCutout,
    label: "+1px hard ring",
    note: "one protective pixel around it",
  },
  {
    alpha: softAlpha,
    cutout: softCutout,
    label: "+1px soft ring",
    note: "that pixel at 0.62 and 0.42 alpha",
  },
  {
    alpha: curvedAlpha,
    cutout: curvedCutout,
    label: "Low-alpha curve",
    note: "weak alpha suppressed, 0.06 to 0.45",
  },
  {
    alpha: sam2Alpha,
    cutout: sam2Cutout,
    label: "SAM2Matting",
    note: "matting on that same boundary",
  },
] as const

export function EdgeCropSheet() {
  return (
    <figure>
      <div className="grid gap-x-5 gap-y-6 sm:grid-cols-2">
        {/* The region the crops come from, first, so the reader has the thing every stage was run
            against before they see any of them. One picture in a two-column row, so it is the same
            size as every tile beside it and the rows stay level. */}
        <div>
          <div className="min-h-14 sm:min-h-10">
            <div className={cn(FIGURE_TYPE.label, "text-foreground font-medium")}>
              Original crop
            </div>
            <div className={cn(FIGURE_TYPE.note, "text-muted-foreground")}>
              Endymion&apos;s staff, at full resolution
            </div>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {/* An empty slot rather than a picture: this row has no mask, and a white square
                would be a mask that keeps everything, which is a different claim. Struck through
                and named, so the left column is the alpha the whole way down and the one row
                without one says so. */}
            <div className="border-border bg-muted text-muted-foreground relative aspect-square overflow-hidden rounded-lg border">
              <svg
                aria-hidden="true"
                className="absolute inset-0 size-full"
                preserveAspectRatio="none"
                viewBox="0 0 100 100"
              >
                <line
                  opacity={0.4}
                  stroke="currentColor"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  x1={0}
                  x2={100}
                  y1={100}
                  y2={0}
                />
              </svg>
              <div className="absolute inset-0 grid place-items-center">
                {/* The background behind the words keeps the rule from running through them. */}
                <span className={cn(FIGURE_TYPE.note, "bg-muted px-1.5")}>No alpha</span>
              </div>
            </div>
            <Tile
              alt="The region these tiles are taken from: Endymion's staff, gems and the pale wing behind them."
              src={artwork}
            />
          </div>
        </div>

        {STAGES.map((stage) => (
          // Each stage is one block: its label, then its two pictures. Blocks tile two-up, so the
          // grouping survives both the wide layout and the narrow one.
          <div key={stage.label}>
            {/* The label and its note take one line each on a wide screen and can wrap on a narrow
                one; holding the pair to a fixed height keeps every block's pictures on one line. */}
            <div className="min-h-14 sm:min-h-10">
              <div className={cn(FIGURE_TYPE.label, "text-foreground font-medium")}>
                {stage.label}
              </div>
              <div className={cn(FIGURE_TYPE.note, "text-muted-foreground")}>{stage.note}</div>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <Tile alt={`${stage.label}: the alpha it produced.`} src={stage.alpha} />
              <Tile
                alt={`${stage.label}: the artwork with that alpha applied.`}
                src={stage.cutout}
              />
            </div>
          </div>
        ))}
      </div>

      <figcaption>
        Each stage shows the alpha it produced on the left, and the artwork with that alpha applied
        on the right.
      </figcaption>
    </figure>
  )
}

function Tile({ alt, src }: { readonly alt: string; readonly src: string }) {
  return (
    <div className="border-border bg-muted overflow-hidden rounded-lg border">
      <img
        alt={alt}
        className="!my-0 !max-h-none !rounded-none !border-0"
        loading="lazy"
        src={src}
      />
    </div>
  )
}
