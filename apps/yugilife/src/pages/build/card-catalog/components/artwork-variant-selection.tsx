import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { CardArtworkChooser } from "./card-artwork-chooser"

import type { LoadedCatalogArtworkSet } from "./card-artwork-chooser"

/** A variant replaces artwork and mask authoring as one unit, so selection is explicit. */
export function ArtworkVariantSelection({
  artworkSet,
  onSelect,
}: {
  artworkSet: LoadedCatalogArtworkSet
  onSelect: (id: number) => void
}) {
  const [pending, setPending] = useState<number>()
  return (
    <>
      <CardArtworkChooser
        artworkSet={artworkSet}
        onSelect={(id) => {
          if (id !== artworkSet.selectedArtworkId) setPending(id)
        }}
      />
      <Dialog
        open={pending !== undefined}
        onOpenChange={(open) => {
          if (!open) setPending(undefined)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch artwork variant?</DialogTitle>
            <DialogDescription>
              This replaces the artwork, image mask, and edited pins with the selected database
              variant. Card text, crop, and effects settings stay unchanged.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(undefined)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (pending !== undefined) onSelect(pending)
                setPending(undefined)
              }}
            >
              Switch variant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
