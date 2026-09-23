import { Fragment } from "react"

import { FIGURE_TYPE } from "@/components/data-visualization"
import { cn } from "@/lib/utils"

import art006 from "./assets/closeups/006-art.webp"
import sam3006 from "./assets/closeups/006-sam3.webp"
import toonout006 from "./assets/closeups/006-toonout.webp"
import art010 from "./assets/closeups/010-art.webp"
import sam3010 from "./assets/closeups/010-sam3.webp"
import toonout010 from "./assets/closeups/010-toonout.webp"
import art015 from "./assets/closeups/015-art.webp"
import sam3015 from "./assets/closeups/015-sam3.webp"
import toonout015 from "./assets/closeups/015-toonout.webp"

/**
 * The same 340-pixel region of three artworks, at full resolution, in three states.
 *
 * The crops are not chosen by eye: each one is centred on the cell where the two alpha maps
 * disagree most, found by differencing them on a grid. Whole-artwork figures cannot show what
 * separates these two outputs, because the difference lives in a few hundred pixels of edge.
 */
const ROWS = [
  {
    art: art006,
    name: "Endymion's staff and gems",
    sam3: sam3006,
    toonout: toonout006,
  },
  {
    art: art010,
    name: "Infinite Impermanence's line work",
    sam3: sam3010,
    toonout: toonout010,
  },
  {
    art: art015,
    name: "Odd-Eyes Rebellion Dragon's horns",
    sam3: sam3015,
    toonout: toonout015,
  },
] as const

const COLUMNS = ["Artwork", "SAM3", "ToonOut"] as const

export function EdgeCloseUps() {
  return (
    <figure>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {COLUMNS.map((column) => (
          <div className={cn(FIGURE_TYPE.label, "text-foreground font-medium")} key={column}>
            {column}
          </div>
        ))}
        {ROWS.map((row) => (
          <Fragment key={row.name}>
            <CloseUp alt={`${row.name}, the artwork itself.`} src={row.art} />
            <CloseUp alt={`${row.name}, as SAM3's soft output.`} src={row.sam3} />
            <CloseUp alt={`${row.name}, as ToonOut's alpha.`} src={row.toonout} />
          </Fragment>
        ))}
      </div>
      <figcaption>
        Three regions at full resolution, each centred where the two outputs disagree most.
      </figcaption>
    </figure>
  )
}

function CloseUp({ alt, src }: { readonly alt: string; readonly src: string }) {
  return (
    <div className="border-border bg-muted overflow-hidden rounded-lg border">
      <img
        // The article caps image height at 70vh with no object fit; these are square crops, but the
        // rule is the article's and not worth relying on.
        alt={alt}
        className="!my-0 !max-h-none !rounded-none !border-0"
        loading="lazy"
        src={src}
      />
    </div>
  )
}
