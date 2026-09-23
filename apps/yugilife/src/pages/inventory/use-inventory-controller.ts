import { useCallback, useEffect, useRef, useState } from "react"

import { useNavigate } from "react-router"
import { TEMPLATE_CATALOG } from "yugilife-templates"

import { createInitialEditorDocument } from "../build/editor/model/editor-store"

import { inventoryPreviewMatchesCard } from "./model/inventory-preview"
import { refreshInventoryPreviews } from "./model/inventory-preview-refresh"
import {
  createInventoryCard,
  deleteInventoryCard,
  duplicateInventoryCard,
  getInventoryStorageMode,
  readInventoryPreview,
} from "./persistence/inventory-storage"
import { initializeInventory } from "./inventory-initialization"

import type { InventoryCardSummary } from "./model/inventory-card"
import type { InventoryPreviewRefreshProgress } from "./model/inventory-preview-refresh"

export interface InventoryPreviewStatus {
  /** Cards whose preview is missing, or whose document is behind its current template. */
  outdated: number
  /** The template version outdated cards would be migrated to, when they share one. */
  templateUpgrade: string | undefined
}

/**
 * The published version of a card's template, or `undefined` when it cannot be known without
 * touching storage. Reading it is free: official descriptors are bundled with the app, and only
 * `load()` fetches assets.
 */
function publishedTemplateVersion(templateId: string) {
  return TEMPLATE_CATALOG.find(({ id }) => id === templateId)?.version
}

/**
 * States what the action will do to this collection, rather than describing the mechanism. The
 * counts that matter are how many cards are behind and the template version they would move to.
 */
export function previewUpdateDescription(total: number, status: InventoryPreviewStatus) {
  if (total === 1) {
    if (status.outdated === 0) {
      return "This card's preview already matches its saved card. Updating re-renders it anyway."
    }
    return status.templateUpgrade
      ? `This card needs a new preview, and is updated to template ${status.templateUpgrade}.`
      : "This card needs a new preview."
  }
  if (status.outdated === 0) {
    return `All ${total} previews already match their saved cards. Updating re-renders every card anyway, which can take a while.`
  }
  const upgrade = status.templateUpgrade
    ? ` Cards on an older template are updated to ${status.templateUpgrade}.`
    : ""
  // The noun agrees with the collection size; the verb agrees with how many are behind.
  const verb = status.outdated === 1 ? "needs" : "need"
  return `${status.outdated} of ${total} cards ${verb} a new preview.${upgrade} Every card is re-rendered, which can take a while.`
}

/** How long a completion message stays before the gallery returns to its resting state. */
const refreshMessageDurationMs = 3000
/**
 * Grace period before an object URL is revoked. A card that is crossfading still points at its old
 * URL, and revoking on the spot blanks the image mid-transition. Comfortably longer than the
 * gallery's fade so the handoff is never visible.
 */
const previewUrlReleaseDelayMs = 700

/**
 * Inventory is a reader. It never migrates a card and never renders a preview on its own: opening a
 * card in the build editor migrates it and commits its thumbnail, and the explicit refresh action
 * below re-renders the whole collection on request. Anything else would make browsing a collection
 * cost a full template download and a card render per card.
 */
export function useInventoryController() {
  const navigate = useNavigate()
  const [cards, setCards] = useState<readonly InventoryCardSummary[]>([])
  const [selectedCardId, setSelectedCardId] = useState<string>()
  const [previewUrls, setPreviewUrls] = useState<Readonly<Record<string, string>>>({})
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string>()
  const [previewRefresh, setPreviewRefresh] = useState<InventoryPreviewRefreshProgress>()
  const [previewRefreshMessage, setPreviewRefreshMessage] = useState<string>()
  const [previewStatus, setPreviewStatus] = useState<InventoryPreviewStatus>({
    outdated: 0,
    templateUpgrade: undefined,
  })
  const refreshRequest = useRef(0)
  const liveUrls = useRef<ReadonlySet<string>>(new Set())
  const previewRefreshRequest = useRef<AbortController>(undefined)

  /**
   * Re-reads the collection. `select` names the card the caller wants left selected, and it is
   * applied in the same update as the list: a card created by an action is chosen the moment the
   * list that contains it lands, with no render in between where the previous card is still the
   * selected one and the gallery has already begun travelling to it.
   */
  const refresh = useCallback(async (select?: string) => {
    const requestId = ++refreshRequest.current
    const cancelled = () => requestId !== refreshRequest.current
    const stagedUrls: string[] = []
    let published = false
    setBusy(true)
    setError(undefined)
    try {
      const summaries = await initializeInventory()
      if (cancelled()) return
      const sorted = [...summaries].sort(
        (left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id),
      )
      setCards(sorted)
      const exists = (id: string | undefined) =>
        id !== undefined && sorted.some((card) => card.id === id)
      setSelectedCardId((current) =>
        exists(select) ? select : exists(current) ? current : sorted[0]?.id,
      )

      const previews: Array<readonly [string, string]> = []
      const upgrades = new Set<string>()
      let outdated = 0
      for (const summary of sorted) {
        const preview = await readInventoryPreview(summary.id)
        if (cancelled()) return
        const currentVersion = publishedTemplateVersion(summary.templateId)
        const behindTemplate =
          currentVersion !== undefined && currentVersion !== summary.templateVersion
        if (behindTemplate) upgrades.add(currentVersion)
        const usable = preview && inventoryPreviewMatchesCard(preview, summary)
        if (!usable || behindTemplate) outdated += 1
        // A card with no committed preview shows its placeholder until it is opened or refreshed.
        if (!usable) continue
        const url = URL.createObjectURL(preview.image)
        stagedUrls.push(url)
        previews.push([summary.id, url])
      }
      setPreviewUrls(Object.fromEntries(previews))
      setPreviewStatus({
        outdated,
        // Only name a target version when every outdated card agrees on one.
        templateUpgrade: upgrades.size === 1 ? [...upgrades][0] : undefined,
      })
      published = true
    } catch (caught: unknown) {
      if (!cancelled()) setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      if (!published) stagedUrls.forEach((url) => URL.revokeObjectURL(url))
      if (!cancelled()) setBusy(false)
    }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0)
    return () => {
      window.clearTimeout(timeout)
      refreshRequest.current += 1
    }
  }, [refresh])

  /**
   * Releasing is deferred and then re-checked against what is currently displayed: a URL that
   * survived into the next map is still on screen and must not be revoked, which is what lets a
   * single card's preview be replaced without disturbing the rest.
   */
  const releasePreviewUrl = useCallback((url: string) => {
    window.setTimeout(() => {
      if (!liveUrls.current.has(url)) URL.revokeObjectURL(url)
    }, previewUrlReleaseDelayMs)
  }, [])

  useEffect(() => {
    const urls = Object.values(previewUrls)
    liveUrls.current = new Set(urls)
    return () => {
      liveUrls.current = new Set()
      urls.forEach(releasePreviewUrl)
    }
  }, [previewUrls, releasePreviewUrl])

  useEffect(
    () => () => {
      previewRefreshRequest.current?.abort()
      previewRefreshRequest.current = undefined
    },
    [],
  )

  useEffect(() => {
    if (previewRefreshMessage === undefined) return
    const timeout = window.setTimeout(
      () => setPreviewRefreshMessage(undefined),
      refreshMessageDurationMs,
    )
    return () => window.clearTimeout(timeout)
  }, [previewRefreshMessage])

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
      await refresh(card.id)
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

  /** Re-renders every stored preview against the template each card currently resolves to. */
  async function refreshPreviews() {
    if (previewRefreshRequest.current) return
    const controller = new AbortController()
    previewRefreshRequest.current = controller
    const active = () => previewRefreshRequest.current === controller
    setError(undefined)
    setPreviewRefreshMessage(undefined)
    setPreviewRefresh({ cardId: undefined, completed: 0, total: cards.length })
    try {
      const result = await refreshInventoryPreviews({
        // Swapping each card as it finishes lets the sweep hand straight over to the new preview,
        // instead of every card changing at once when the whole run ends.
        onCardRendered: (cardId) => {
          if (!active()) return
          void readInventoryPreview(cardId).then((preview) => {
            if (!active() || !preview) return
            const url = URL.createObjectURL(preview.image)
            setPreviewUrls((current) => ({ ...current, [cardId]: url }))
          })
        },
        onProgress: (progress) => {
          if (active()) setPreviewRefresh(progress)
        },
        signal: controller.signal,
      })
      if (!active()) return
      if (result.failed.length > 0) {
        setError(
          `${result.failed.length} card${result.failed.length === 1 ? "" : "s"} could not be updated: ${result.failed.join(", ")}.`,
        )
      } else {
        setPreviewRefreshMessage(
          `Updated ${result.updated} ${result.updated === 1 ? "preview" : "previews"}.`,
        )
      }
      await refresh()
    } catch (caught: unknown) {
      if (!active() || controller.signal.aborted) return
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      if (active()) {
        previewRefreshRequest.current = undefined
        setPreviewRefresh(undefined)
      }
    }
  }

  function cancelPreviewRefresh() {
    if (!previewRefreshRequest.current) return
    previewRefreshRequest.current.abort()
    previewRefreshRequest.current = undefined
    setPreviewRefresh(undefined)
    // Cards committed before the cancellation keep their new previews, so the gallery is re-read.
    setPreviewRefreshMessage("Preview update cancelled.")
    void refresh()
  }

  return {
    busy,
    cancelPreviewRefresh,
    cards,
    createCard,
    deleteCard,
    duplicateCard,
    error,
    previewRefresh,
    previewRefreshMessage,
    /** The card whose preview is being rendered right now, for the gallery's placeholder. */
    renderingCardId: previewRefresh?.cardId,
    previewStatus,
    previewUrls,
    refreshPreviews,
    selectedCardId,
    setSelectedCardId,
    storageMode: getInventoryStorageMode(),
  }
}
