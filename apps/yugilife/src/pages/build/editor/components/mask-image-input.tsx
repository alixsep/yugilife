import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FieldError } from "@/components/ui/field"
import { ImageDropzone } from "@/components/ui/file-upload"
import { inspectImageInput } from "@/lib/image-input"

interface MaskImageInputProps {
  artwork: Blob
  value: Blob | undefined
  onChange: (value: Blob | undefined) => void
}

export function MaskImageInput({ artwork, value, onChange }: MaskImageInputProps) {
  const request = useRef(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState<{
    artwork: Blob
    previous: Blob | undefined
    image: Blob
    source: string
    target: string
  }>()
  const [inputIdentity, setInputIdentity] = useState({ artwork, value })
  if (inputIdentity.artwork !== artwork || inputIdentity.value !== value) {
    setInputIdentity({ artwork, value })
    setBusy(false)
    setPending(undefined)
    setError(undefined)
  }
  useEffect(
    () => () => {
      request.current += 1
    },
    [artwork, value],
  )

  const change = async (image: Blob | null) => {
    const id = ++request.current
    setPending(undefined)
    setError(undefined)
    if (!image) {
      onChange(undefined)
      return
    }
    setBusy(true)
    try {
      const [source, target] = await Promise.all([
        inspectImageInput(image),
        inspectImageInput(artwork),
      ])
      if (request.current !== id) return
      if (source.width !== target.width || source.height !== target.height) {
        setPending({
          artwork,
          previous: value,
          image,
          source: `${source.width} × ${source.height}`,
          target: `${target.width} × ${target.height}`,
        })
      } else onChange(image)
    } catch (reason) {
      if (request.current === id)
        setError(reason instanceof Error ? reason.message : "Unable to open the mask.")
    } finally {
      if (request.current === id) setBusy(false)
    }
  }
  const confirmation =
    pending?.artwork === artwork && pending.previous === value ? pending : undefined
  return (
    <>
      <ImageDropzone
        actionsOverlay
        accept="image/*"
        disabled={busy}
        showAcceptHint={false}
        value={value ?? null}
        onValueChange={(image) => void change(image)}
      >
        Drop an image mask here or click to browse
      </ImageDropzone>
      <p className="text-caption text-muted-foreground">
        White keeps artwork; black hides it. The whole mask fits the artwork, including any crop or
        pan. Removing the image mask keeps your dot mask and pins. With no image mask, the
        over-frame cutout is hidden; the artwork inside its window remains visible.
      </p>
      {busy && (
        <p role="status" className="text-caption">
          Checking mask dimensions…
        </p>
      )}
      {error && <FieldError>{error}</FieldError>}
      <Dialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open) setPending(undefined)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fit this mask to the artwork?</DialogTitle>
            <DialogDescription>
              This mask is {confirmation?.source} pixels; the artwork is {confirmation?.target}. The
              whole mask will stretch to fit the artwork. A different aspect ratio can distort the
              selection. Your current mask stays unchanged unless you apply it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(undefined)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (confirmation) onChange(confirmation.image)
                setPending(undefined)
              }}
            >
              Fit and apply mask
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
