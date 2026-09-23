/** A user-editable seed used by the dot-mask segmentation engine. */
export interface PinMaskPoint {
  id: number
  polarity: "keep" | "remove"
  size: number
  x: number
  y: number
}

/** App-only presentation adjustments applied to a mask before it clips artwork. */
export interface ArtworkMaskEffects {
  antiAlias?: boolean
  glow?: number
}
