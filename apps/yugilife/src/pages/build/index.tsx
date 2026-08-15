import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { useNavigate, useParams } from "react-router"

import { usePageTransitionReady } from "@/components/page-transition-ready"

import { initializeInventory } from "../inventory/inventory-initialization"
import {
  readActiveInventoryCardId,
  writeActiveInventoryCardId,
} from "../inventory/persistence/inventory-settings"
import { createInventoryCard, readInventoryCard } from "../inventory/persistence/inventory-storage"

import { createInitialEditorDocument } from "./editor/model/editor-store"
import { BuildView } from "./page/build-view"
import { useBuildController } from "./page/use-build-controller"

export function Build() {
  const { cardId } = useParams()
  useLayoutEffect(() => {
    document.documentElement.classList.add("build-route")
    return () => document.documentElement.classList.remove("build-route")
  }, [])
  if (!cardId) return <CurrentCardBuild />
  // A route parameter change selects a different editor document. Keep the
  // controller card-scoped so its async template restore and persistence refs
  // cannot leak into the next card and hold the route transition open.
  return <CardBuild key={cardId} cardId={cardId} />
}

function CurrentCardBuild() {
  const navigate = useNavigate()
  const started = useRef(false)
  const [error, setError] = useState<string>()

  usePageTransitionReady(Boolean(error))

  useEffect(() => {
    if (started.current) return
    started.current = true
    const openCurrentCard = async () => {
      const inventory = await initializeInventory()
      const activeCardId = readActiveInventoryCardId()
      if (activeCardId && (await readInventoryCard(activeCardId))) {
        await navigate(`/build/${encodeURIComponent(activeCardId)}`, { replace: true })
        return
      }
      const firstCard = inventory[0]
      if (firstCard) {
        writeActiveInventoryCardId(firstCard.id)
        await navigate(`/build/${encodeURIComponent(firstCard.id)}`, { replace: true })
        return
      }
      const card = await createInventoryCard(createInitialEditorDocument())
      writeActiveInventoryCardId(card.id)
      await navigate(`/build/${encodeURIComponent(card.id)}`, { replace: true })
    }
    void openCurrentCard().catch((caught: unknown) =>
      setError(caught instanceof Error ? caught.message : String(caught)),
    )
  }, [navigate])

  return (
    <main>
      <h1>Build a card</h1>
      {error ? <p role="alert">Could not open a card: {error}</p> : <p>Opening card…</p>}
    </main>
  )
}

function CardBuild({ cardId }: { cardId: string }) {
  const controller = useBuildController(cardId)
  const ready = !controller.inventoryBusy

  usePageTransitionReady(ready)

  return <BuildView controller={controller} />
}
