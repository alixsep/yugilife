import { useEffect, useRef } from "react"

import * as RadioGroup from "@radix-ui/react-radio-group"
import { Check } from "lucide-react"

import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { useShape } from "@/lib/shape-context"
import { cn } from "@/lib/utils"

import type { LoadedCardArtwork } from "../model/card-artwork-loader"
import type { CardCatalogEntry } from "../model/card-catalog"

export interface LoadedCatalogArtworkSet {
  artworks: ReadonlyMap<number, LoadedCardArtwork>
  entry: CardCatalogEntry
  selectedArtworkId: number
}

interface CardArtworkChooserProps {
  artworkSet: LoadedCatalogArtworkSet
  onSelect: (artworkId: number) => void
}

function ArtworkPreview({ artwork }: { artwork: LoadedCardArtwork }) {
  const image = useRef<HTMLImageElement>(null)
  const shape = useShape()

  useEffect(() => {
    const source = URL.createObjectURL(artwork.image)
    if (image.current) image.current.src = source
    return () => URL.revokeObjectURL(source)
  }, [artwork.image])

  return (
    <img
      ref={image}
      alt=""
      className={cn("bg-muted size-full object-contain", shape.input)}
      draggable={false}
    />
  )
}

export function CardArtworkChooser({ artworkSet, onSelect }: CardArtworkChooserProps) {
  const shape = useShape()

  return (
    <Field>
      <FieldLabel>Artwork variants</FieldLabel>
      <RadioGroup.Root
        aria-label={`Artwork for ${artworkSet.entry.name}`}
        className="grid grid-cols-4 gap-2 sm:grid-cols-6"
        value={String(artworkSet.selectedArtworkId)}
        onValueChange={(value) => onSelect(Number(value))}
      >
        {artworkSet.entry.artworkIds.flatMap((artworkId, index) => {
          const artwork = artworkSet.artworks.get(artworkId)
          if (!artwork) return []
          return (
            <RadioGroup.Item
              aria-label={`${artworkSet.entry.name} artwork ${index + 1}`}
              className={cn(
                "border-border bg-muted/40 hover:bg-muted data-[state=checked]:border-foreground relative aspect-square min-w-0 overflow-hidden border p-1 ring-1 ring-transparent transition-[background-color,border-color,box-shadow] duration-80 outline-none focus-visible:ring-(--focus-ring)",
                shape.input,
              )}
              key={artworkId}
              value={String(artworkId)}
            >
              <ArtworkPreview artwork={artwork} />
              <RadioGroup.Indicator
                className={cn(
                  "bg-foreground text-background absolute top-1 right-1 flex size-5 items-center justify-center shadow-sm",
                  shape.button,
                )}
              >
                <Check aria-hidden="true" className="size-3.5" />
              </RadioGroup.Indicator>
            </RadioGroup.Item>
          )
        })}
      </RadioGroup.Root>
      <FieldDescription>
        Choose a downloaded variant together with its verified default alpha mask.
      </FieldDescription>
    </Field>
  )
}
