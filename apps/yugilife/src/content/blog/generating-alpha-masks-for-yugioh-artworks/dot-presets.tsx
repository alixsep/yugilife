import { FIGURE_TYPE } from "@/components/data-visualization"
import { cn } from "@/lib/utils"

import artPoints from "./assets/points/art.webp"
import detail from "./assets/points/detail.webp"
import dots from "./assets/points/dots.webp"
import mask from "./assets/points/mask.webp"

/**
 * A finished mask, the points derived from it, and where those points land on the drawing.
 *
 * Three columns rather than a before/after pair: the middle tile is the only place the detector's
 * own output is legible, and the third is the one that shows the points are not decoration — they
 * sit on the boundary a person would have clicked along. The detail strip underneath is the same
 * points at full resolution, because at a third of the column the pairing across the edge is a
 * speckle.
 */
const COLUMNS = [
  {
    alt: "The finished mask for the artwork, white subject on black.",
    label: "The mask",
    src: mask,
  },
  {
    alt: "The same mask with the detector's points on it: green keeps, red removes, and larger disks in the deep interior and exterior.",
    label: "Its points",
    src: dots,
  },
  {
    alt: "The same points drawn over the artwork itself, tracing the character's outline.",
    label: "On the artwork",
    src: artPoints,
  },
] as const

export function DotPresets() {
  return (
    <figure>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {COLUMNS.map((column) => (
          <div className={cn(FIGURE_TYPE.label, "text-foreground font-medium")} key={column.label}>
            {column.label}
          </div>
        ))}
        {COLUMNS.map((column) => (
          <Tile alt={column.alt} key={column.label} src={column.src} />
        ))}
      </div>
      <div className="mt-2 sm:mt-3">
        <Tile
          alt="One hand at full resolution, with keep points just inside the silhouette and remove points just outside it, paired across the boundary."
          src={detail}
        />
      </div>
      <figcaption>
        The strip underneath is one hand at full resolution, where each pair sits across the edge.
      </figcaption>
    </figure>
  )
}

function Tile({ alt, src }: { readonly alt: string; readonly src: string }) {
  return (
    <div className="border-border bg-muted overflow-hidden rounded-lg border">
      <img
        // The article caps image height at 70vh with no object fit; these are all wider than tall
        // or square, but the rule is the article's and not worth relying on.
        alt={alt}
        className="!my-0 !max-h-none !rounded-none !border-0"
        loading="lazy"
        src={src}
      />
    </div>
  )
}
