import { useCallback, useEffect, useMemo, useState } from "react"

import { useNavigate } from "react-router"

import { createInitialEditorDocument } from "../build/editor/model/editor-store"

import { upgradePersistedInventoryCardToCurrentTemplate } from "./model/inventory-card-upgrade"
import { inventoryPreviewMatchesCard } from "./model/inventory-preview"
import { recoverInventoryPreview } from "./model/inventory-preview-recovery"
import {
  createInventoryCard,
  deleteInventoryCard,
  duplicateInventoryCard,
  getInventoryStorageMode,
  readInventoryCard,
  readInventoryPreview,
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
          if (!card) return { card: undefined, summary }
          try {
            const next = await upgradePersistedInventoryCardToCurrentTemplate(card)
            return {
              card: next,
              summary: {
                createdAt: next.createdAt,
                id: next.id,
                revision: next.revision,
                templateId: next.document.templateId,
                templateVersion: next.document.templateVersion,
                title: next.title,
                updatedAt: next.updatedAt,
              },
            }
          } catch {
            // The record remains visible and recoverable. Opening it reports the actionable
            // migration or missing-template error rather than substituting another template.
            return { card, summary }
          }
        }),
      )
      const sorted = migrated.sort(
        (left, right) =>
          right.summary.createdAt - left.summary.createdAt ||
          right.summary.id.localeCompare(left.summary.id),
      )
      const sortedSummaries = sorted.map(({ summary }) => summary)
      setCards(sortedSummaries)
      setSelectedCardId((current) =>
        current && sortedSummaries.some(({ id }) => id === current)
          ? current
          : sortedSummaries[0]?.id,
      )

      const previews: Array<readonly [string, string] | undefined> = []
      // Recovery renders are intentionally sequential: one missing preview must not turn opening
      // Inventory into a burst of simultaneous full-card renders.
      for (const { card, summary } of sorted) {
        let preview = await readInventoryPreview(summary.id)
        if (card && (!preview || !inventoryPreviewMatchesCard(preview, summary))) {
          try {
            preview = await recoverInventoryPreview(preview, card)
          } catch (recoveryError) {
            if (import.meta.env.DEV) {
              console.warn(`Could not recover preview for inventory card "${summary.id}".`, {
                cardRevision: summary.revision,
                previewRevision: preview?.cardRevision,
                previewFingerprint: preview?.renderFingerprint,
                recoveryError,
                templateId: summary.templateId,
                templateVersion: summary.templateVersion,
              })
            }
          }
        }
        previews.push(
          preview && inventoryPreviewMatchesCard(preview, summary)
            ? ([summary.id, URL.createObjectURL(preview.image)] as const)
            : undefined,
        )
      }
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
