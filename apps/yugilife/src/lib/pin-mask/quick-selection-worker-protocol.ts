import type { PinMaskPoint } from "./quick-selection-types"

/** Messages crossing the main-thread/worker boundary for one prepared artwork. */
export type QuickSelectionWorkerRequest =
  | {
      id: number
      bitmap: ImageBitmap
      type: "prepare-bitmap"
    }
  | {
      height: number
      id: number
      rgba: ArrayBuffer
      type: "prepare"
      width: number
    }
  | {
      id: number
      points: readonly PinMaskPoint[]
      encode?: boolean
      type: "refine"
    }

export type QuickSelectionWorkerResponse =
  | { height: number; id: number; type: "prepared"; width: number }
  | { id: number; mask: ArrayBuffer; blob?: Blob; type: "refined" }
  | { id: number; message: string; type: "error" }
