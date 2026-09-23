import { createCardCatalogSearch, parseCardCatalog } from "./card-catalog"

import type { CardCatalogSearch } from "./card-catalog"
import type {
  CardCatalogWorkerRequest,
  CardCatalogWorkerResponse,
} from "./card-catalog-worker-protocol"

let search: CardCatalogSearch | undefined

function respond(response: CardCatalogWorkerResponse) {
  globalThis.postMessage(response)
}

async function digest(source: Uint8Array) {
  if (!globalThis.crypto?.subtle) throw new Error("This browser cannot verify catalog integrity.")
  const bytes = Uint8Array.from(source)
  const value = await crypto.subtle.digest("SHA-256", bytes.buffer)
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function loadCatalog(request: Extract<CardCatalogWorkerRequest, { type: "load" }>) {
  const { record } = request
  if (record.data.byteLength !== record.compressedBytes) {
    throw new Error("The compressed card catalog byte count is invalid.")
  }
  if ((await digest(record.data)) !== record.artifactSha256) {
    throw new Error("The compressed card catalog failed integrity verification.")
  }

  respond({ id: request.id, progress: { phase: "decoding" }, type: "progress" })
  let decompressed: Uint8Array
  try {
    const brotliModule = await import("brotli-wasm")
    const brotli = await brotliModule.default
    decompressed = brotli.decompress(record.data)
  } catch {
    throw new Error("The card catalog could not be decompressed.")
  }
  if (decompressed.byteLength !== record.uncompressedBytes) {
    throw new Error("The decoded card catalog byte count is invalid.")
  }

  respond({ id: request.id, progress: { phase: "validating" }, type: "progress" })
  if ((await digest(decompressed)) !== record.catalogSha256) {
    throw new Error("The decoded card catalog failed integrity verification.")
  }
  const catalog = parseCardCatalog(new TextDecoder().decode(decompressed), record.recordCount)
  search = createCardCatalogSearch(catalog)
}

globalThis.addEventListener("message", (event: MessageEvent<CardCatalogWorkerRequest>) => {
  const request = event.data
  if (request.type === "search") {
    try {
      if (!search) throw new Error("The card catalog worker is not ready.")
      respond({
        entries: search.search(request.query, request.limit),
        id: request.id,
        type: "results",
      })
    } catch (error) {
      respond({
        id: request.id,
        message: error instanceof Error ? error.message : "Card catalog search failed.",
        type: "error",
      })
    }
    return
  }

  void loadCatalog(request)
    .then(() => respond({ id: request.id, type: "ready" }))
    .catch((error: unknown) =>
      respond({
        id: request.id,
        message: error instanceof Error ? error.message : "The card catalog could not be opened.",
        type: "error",
      }),
    )
})
