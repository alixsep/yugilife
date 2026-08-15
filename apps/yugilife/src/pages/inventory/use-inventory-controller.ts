import { useCallback, useEffect, useMemo, useState } from "react"

import { useNavigate } from "react-router"

import { createInitialEditorDocument } from "../build/editor/model/editor-store"

import { migrateInventoryCardToCurrentTemplate } from "./model/inventory-card-migration"
import {
  createInventoryCard,
  deleteInventoryCard,
  duplicateInventoryCard,
  getInventoryStorageMode,
  readInventoryCard,
  readInventoryPreview,
  saveInventoryCard,
} from "./persistence/inventory-storage"
import { initializeInventory } from "./inventory-initialization"

import type { InventoryCardSummary } from "./model/inventory-card"

export function useInventoryController() {
  const navigate = useNavigate()
  const [cards, setCards] = useState<readonly InventoryCardSummary[]>([])
  const [selectedCardId, setSelectedCardId] = useState<string>()
  const [previewUrls, setPreviewUrls] = useState<Readonly<Record<string, string>>>({})
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      const summaries = await initializeInventory()
      const migrated = await Promise.all(
        summaries.map(async (summary) => {
          const card = await readInventoryCard(summary.id)
          if (!card) return summary
          try {
            const next = await migrateInventoryCardToCurrentTemplate(card)
            if (next !== card) await saveInventoryCard(next)
            return {
              createdAt: next.createdAt,
              id: next.id,
              revision: next.revision,
              templateId: next.document.templateId,
              templateVersion: next.document.templateVersion,
              title: next.title,
              updatedAt: next.updatedAt,
            }
          } catch {
            // The record remains visible and recoverable. Opening it reports the actionable
            // migration or missing-template error rather than substituting another template.
            return summary
          }
        }),
      )
      const sorted = migrated.sort(
        (left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id),
      )
      setCards(sorted)
      setSelectedCardId((current) =>
        current && sorted.some(({ id }) => id === current) ? current : sorted[0]?.id,
      )

      const previews = await Promise.all(
        sorted.map(async (card) => {
          const preview = await readInventoryPreview(card.id)
          if (!preview || preview.cardRevision !== card.revision) return undefined
          const expectedFingerprint = `${card.templateId}@${card.templateVersion}:preview-v1`
          if (preview.renderFingerprint !== expectedFingerprint) return undefined
          return [card.id, URL.createObjectURL(preview.image)] as const
        }),
      )
      setPreviewUrls(Object.fromEntries(previews.filter((entry) => entry !== undefined)))
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timeout)
  }, [refresh])

  useEffect(
    () => () => Object.values(previewUrls).forEach((url) => URL.revokeObjectURL(url)),
    [previewUrls],
  )

  const selectedCard = useMemo(
    () => cards.find(({ id }) => id === selectedCardId),
    [cards, selectedCardId],
  )

  async function createCard() {
    setError(undefined)
    try {
      const card = await createInventoryCard(createInitialEditorDocument())
      void navigate(`/build/${encodeURIComponent(card.id)}`)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  async function duplicateCard(id: string) {
    setError(undefined)
    try {
      const card = await duplicateInventoryCard(id)
      await refresh()
      setSelectedCardId(card.id)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  async function deleteCard(id: string) {
    setError(undefined)
    try {
      await deleteInventoryCard(id)
      await refresh()
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  return {
    busy,
    cards,
    createCard,
    deleteCard,
    duplicateCard,
    error,
    previewUrls,
    selectedCard,
    selectedCardId,
    setSelectedCardId,
    storageMode: getInventoryStorageMode(),
  }
}
