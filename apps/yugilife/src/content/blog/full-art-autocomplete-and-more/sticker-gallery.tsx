import sticker00 from "./assets/stickers/sticker-00.webp"
import sticker01 from "./assets/stickers/sticker-01.webp"
import sticker02 from "./assets/stickers/sticker-02.webp"
import sticker03 from "./assets/stickers/sticker-03.webp"
import sticker04 from "./assets/stickers/sticker-04.webp"
import sticker05 from "./assets/stickers/sticker-05.webp"
import sticker06 from "./assets/stickers/sticker-06.webp"
import sticker07 from "./assets/stickers/sticker-07.webp"
import sticker08 from "./assets/stickers/sticker-08.webp"
import sticker09 from "./assets/stickers/sticker-09.webp"
import sticker10 from "./assets/stickers/sticker-10.webp"
import sticker11 from "./assets/stickers/sticker-11.webp"
import sticker12 from "./assets/stickers/sticker-12.webp"

/**
 * The thirteen security foils at their native 42px rather than enlarged: the asset is 42px, and
 * scaling it up would show a blur that does not exist on a real card.
 */
const STICKERS = [
  sticker00,
  sticker01,
  sticker02,
  sticker03,
  sticker04,
  sticker05,
  sticker06,
  sticker07,
  sticker08,
  sticker09,
  sticker10,
  sticker11,
  sticker12,
] as const

export function StickerGallery() {
  return (
    <figure>
      {/* One box rather than thirteen: the foils are a set you pick from, and giving each its own
          frame turned a palette into a row of unrelated specimens. */}
      <div className="border-border bg-muted mx-auto grid w-fit grid-cols-4 gap-4 rounded-lg border p-4 sm:gap-5 sm:p-5">
        {STICKERS.map((src, index) => (
          <img
            alt={`Security foil variant ${index + 1} of ${STICKERS.length}.`}
            className="!my-0 !max-h-none !w-[42px] !rounded-none !border-0"
            key={src}
            loading="lazy"
            src={src}
          />
        ))}
      </div>
      <figcaption>The 13 supported stickers.</figcaption>
    </figure>
  )
}
