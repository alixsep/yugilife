import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { FieldError } from "@/components/ui/field"

import { useEditorStore } from "../../editor/model/editor-store"
import { loadCardArtworkAlpha, loadCardArtworks } from "../model/card-artwork-loader"

import type { ArtworkMaskEditingState } from "../../editor/model/editor-document"
import type { CardFieldValue } from "yugilife-core"

type RecoveryTarget = "artwork" | "mask" | "pins"

const actions = [
  {
    target: "artwork",
    label: "Restore artwork",
    description:
      "Restore the original artwork together with its database image mask and starting pins. This replaces the current artwork and both mask selections. Card text and presentation settings stay unchanged.",
  },
  {
    target: "mask",
    label: "Restore image mask",
    description:
      "Replace only the image mask with the database version. Your artwork, dot mask, pins, and current mask mode stay unchanged.",
  },
  {
    target: "pins",
    label: "Restore pins",
    description:
      "Replace your edited pins with the database starting pins and recalculate the dot mask. Your artwork and image mask stay unchanged.",
  },
] as const

export function CatalogArtworkRecovery({
  mask,
  applyPatch,
  onMaskChange,
}: {
  mask: ArtworkMaskEditingState
  applyPatch: (
    patch: Readonly<Record<string, CardFieldValue>>,
    mask: ArtworkMaskEditingState,
  ) => void
  onMaskChange: (mask: ArtworkMaskEditingState) => void
}) {
  const request = useRef<AbortController | undefined>(undefined)
  const [busy, setBusy] = useState<RecoveryTarget>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const source = mask.catalogSource
  const [activeSource, setActiveSource] = useState(source)
  if (activeSource !== source) {
    setActiveSource(source)
    setBusy(undefined)
    setError(undefined)
    setNotice(undefined)
  }
  useEffect(
    () => () => {
      request.current?.abort()
      request.current = undefined
    },
    [source],
  )

  const recover = async (target: RecoveryTarget) => {
    if (!source) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const snapshot = useEditorStore.getState()
    setBusy(target)
    setError(undefined)
    setNotice(undefined)
    try {
      const artwork =
        target === "artwork"
          ? (
              await loadCardArtworks(
                { ...source, artworkIds: [source.artworkId] },
                { signal: controller.signal },
              )
            ).artworks.get(source.artworkId)
          : await loadCardArtworkAlpha(source, { signal: controller.signal })
      if (controller.signal.aborted || request.current !== controller) return
      const current = useEditorStore.getState()
      if (current.card !== snapshot.card || current.artworkMask !== snapshot.artworkMask) {
        throw new Error(
          "The card changed while downloading. Nothing was replaced; retry when your edits are finished.",
        )
      }
      if (!artwork)
        throw new Error(
          "This database artwork is not available yet. Your current artwork and masks were kept.",
        )
      if (target === "artwork") {
        if (!("image" in artwork) || !(artwork.image instanceof Blob))
          throw new Error("The database artwork is unavailable. Nothing was replaced.")
        applyPatch(
          { artwork: artwork.image, artworkOverlay: "" },
          {
            catalogSource: source,
            automaticMask: artwork.alphaMask,
            points: artwork.maskPoints ?? [],
            mode: "automatic",
          },
        )
        setNotice(
          artwork.alphaMask
            ? "Database artwork and mask restored."
            : "Artwork restored. No database image mask is available yet.",
        )
      } else if (target === "mask") {
        if (!artwork.alphaMask)
          throw new Error("No database image mask is available yet. Your current mask was kept.")
        onMaskChange({ ...mask, automaticMask: artwork.alphaMask })
        setNotice("Database image mask restored.")
      } else {
        if (!artwork.maskPoints)
          throw new Error("No database pins are available yet. Your current pins were kept.")
        onMaskChange({ ...mask, mode: "manual", points: artwork.maskPoints, manualMask: undefined })
        setNotice("Database pins restored.")
      }
    } catch (reason) {
      if (!controller.signal.aborted && request.current === controller)
        setError(reason instanceof Error ? reason.message : "Unable to restore the artwork.")
    } finally {
      if (request.current === controller) {
        request.current = undefined
        setBusy(undefined)
      }
    }
  }

  if (!source) return null
  return (
    <div className="grid gap-2">
      <div aria-label="Artwork recovery actions" className="grid gap-2" role="group">
        {actions.map((action) => (
          <ConfirmDialog
            key={action.target}
            title={`${action.label}?`}
            description={action.description}
            confirmLabel="Restore"
            disabled={!!busy}
            onConfirm={() => void recover(action.target)}
            trigger={
              <Button
                className="w-full whitespace-nowrap"
                variant="tertiary"
                loading={busy === action.target}
              >
                {action.label}
              </Button>
            }
          />
        ))}
        {busy && (
          <Button
            className="w-full whitespace-nowrap"
            variant="ghost"
            onClick={() => {
              request.current?.abort()
              request.current = undefined
              setBusy(undefined)
              setNotice("Restoration cancelled. Nothing was changed.")
            }}
          >
            Cancel restoration
          </Button>
        )}
      </div>
      {busy && (
        <p role="status" className="text-caption">
          Downloading and verifying database artwork…
        </p>
      )}
      {notice && (
        <p role="status" className="text-caption">
          {notice}
        </p>
      )}
      {error && <FieldError>{error}</FieldError>}
    </div>
  )
}
