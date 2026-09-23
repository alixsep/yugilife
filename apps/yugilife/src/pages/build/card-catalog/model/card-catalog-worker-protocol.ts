import type { CachedCardCatalog } from "../persistence/card-catalog-storage"
import type { CardCatalogEntry } from "./card-catalog"

export type CardCatalogWorkerProgress = { phase: "decoding" } | { phase: "validating" }

export type CardCatalogWorkerCommand =
  | {
      record: Omit<CachedCardCatalog, "storedAt">
      type: "load"
    }
  | { limit: number; query: string; type: "search" }

export type CardCatalogWorkerRequest = CardCatalogWorkerCommand & { id: number }

export type CardCatalogWorkerResponse =
  | { id: number; progress: CardCatalogWorkerProgress; type: "progress" }
  | { id: number; type: "ready" }
  | { entries: readonly CardCatalogEntry[]; id: number; type: "results" }
  | { id: number; message: string; type: "error" }
