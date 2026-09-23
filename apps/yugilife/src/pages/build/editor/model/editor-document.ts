import type { PinMaskPoint } from "@/lib/pin-mask/quick-selection"
import type { ArtworkMaskEffects } from "@/lib/pin-mask/quick-selection-types"
import type { CardData, LayerVisibility, PresentationOverrides, TemplateId } from "yugilife-core"

export type { ArtworkMaskEffects } from "@/lib/pin-mask/quick-selection-types"

export type EditorMode = "automatic" | "advanced"

export interface CatalogArtworkSource {
  artworkId: number
  cardCid: number
  name: string
  passcode?: string
}

export interface ArtworkMaskEditingState {
  /** Verified database identity, retained when artwork/masks are removed for later restoration. */
  catalogSource?: CatalogArtworkSource

  /** The database/user-supplied grayscale image shown by the Image mask mode. */
  automaticMask?: Blob | undefined
  /** The generated image produced from pins while Dot mask mode is active. */
  manualMask?: Blob | undefined
  /** Persisted names are retained for document compatibility; the UI calls these Image/Dot. */
  mode: "automatic" | "manual"
  /** Database pins remain editable metadata independently of either image source. */
  points: readonly PinMaskPoint[]
}

export interface EditorDocumentState {
  /** App-owned editable mask sources; the selected source is projected into template CardData. */
  artworkMask: ArtworkMaskEditingState
  /** App-owned derived mask presentation settings; core receives only the resulting mask image. */
  artworkMaskEffects: Readonly<Record<string, ArtworkMaskEffects | undefined>>
  card: CardData
  /** Explicit values remain persisted while their semantic branch is dormant. */
  layers: LayerVisibility
  mode: EditorMode
  presetOverrides: Readonly<Record<string, string>>
  presentationOverrides: PresentationOverrides
  templateId: TemplateId
  templateVersion: string
}
