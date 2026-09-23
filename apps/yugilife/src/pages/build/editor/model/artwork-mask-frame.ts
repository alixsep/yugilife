import type { ArtworkMaskChannel } from "@/lib/pin-mask/artwork-mask-effects"

/** Provenance of a complete effects frame, separate from the current editable mask. */
export interface ArtworkMaskFrameIdentity {
  artwork: Blob
  source: Blob
  mode: "automatic" | "manual"
  channel: ArtworkMaskChannel
  effectsKey: string
}

export function canPresentArtworkMaskFrame(
  frame: ArtworkMaskFrameIdentity | undefined,
  requested: ArtworkMaskFrameIdentity | undefined,
) {
  return (
    !!frame &&
    !!requested &&
    frame.artwork === requested.artwork &&
    frame.mode === requested.mode &&
    frame.channel === requested.channel
  )
}

export function isArtworkMaskFrameCurrent(
  frame: ArtworkMaskFrameIdentity | undefined,
  requested: ArtworkMaskFrameIdentity | undefined,
) {
  return (
    canPresentArtworkMaskFrame(frame, requested) &&
    frame!.source === requested!.source &&
    frame!.effectsKey === requested!.effectsKey
  )
}
