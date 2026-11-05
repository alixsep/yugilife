import { useEffect, useRef, useState } from "react"

import { useNavigate } from "react-router"
import { parseRichText, plainTextFromRichText } from "yugilife-core"

import { errorMessage } from "@/lib/utils"

import { migrateInventoryCardToCurrentTemplate } from "../../inventory/model/inventory-card-migration"
import { inventoryPreviewMatchesCard } from "../../inventory/model/inventory-preview"
import {
  processedInventoryMask,
  renderInventoryPreview,
} from "../../inventory/model/inventory-preview-render"
import { writeActiveInventoryCardId } from "../../inventory/persistence/inventory-settings"
import {
  createInventoryCard,
  getInventoryStorageMode,
  readInventoryCard,
  readInventoryPreview,
  saveInventoryCardSnapshot,
} from "../../inventory/persistence/inventory-storage"
import { createInitialEditorDocument } from "../editor/model/editor-store"

import type { EditorDocumentState } from "../editor/model/editor-document"
import type { CardTemplateBundle } from "yugilife-core"

type InventoryCard = NonNullable<Awaited<ReturnType<typeof readInventoryCard>>>

function editorValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (left instanceof Blob || right instanceof Blob) return false
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => editorValuesEqual(value, right[index]))
    )
  }
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) {
    return false
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  return (
    leftKeys.length === Object.keys(rightRecord).length &&
    leftKeys.every(
      (key) => key in rightRecord && editorValuesEqual(leftRecord[key], rightRecord[key]),
    )
  )
}

function bundleRendersDocument(
  bundle: CardTemplateBundle | undefined,
  document: EditorDocumentState,
): bundle is CardTemplateBundle {
  return (
    bundle?.manifest.id === document.templateId &&
    bundle.manifest.version === document.templateVersion
  )
}

interface InventorySessionInput {
  readonly cardId: string
  readonly currentDocument: EditorDocumentState
  readonly onCardOpened: (document: EditorDocumentState) => void
  readonly onCardOpening: () => void
  readonly processedMaskForDocument: (document: EditorDocumentState) => Promise<Blob | undefined>
  readonly replaceDocument: (document: EditorDocumentState) => void
  readonly setInventoryBusy: (busy: boolean) => void
  readonly templateBundle: CardTemplateBundle | undefined
}

export function useInventorySession({
  cardId,
  currentDocument,
  onCardOpened,
  onCardOpening,
  processedMaskForDocument,
  replaceDocument,
  setInventoryBusy,
  templateBundle,
}: InventorySessionInput) {
  const navigate = useNavigate()
  const [inventoryError, setInventoryError] = useState<string>()
  const [inventorySaveError, setInventorySaveError] = useState<string>()
  const [savingCard, setSavingCard] = useState(false)
  const [savedDocument, setSavedDocument] = useState<EditorDocumentState>()
  const [newCardBusy, setNewCardBusy] = useState(false)
  const [newCardError, setNewCardError] = useState<string>()
  const inventoryCard = useRef<InventoryCard>(undefined)
  // State, not a ref: the card load and the bundle load race, and whichever lands last commits.
  const [pendingSnapshotCardId, setPendingSnapshotCardId] = useState<string>()
  const startedSnapshotCardId = useRef<string>(undefined)
  const snapshotCommitToken = useRef(0)

  const hasUnsavedChanges = savedDocument
    ? !editorValuesEqual(currentDocument, savedDocument)
    : false

  useEffect(() => {
    let cancelled = false
    inventoryCard.current = undefined
    const timeout = window.setTimeout(() => {
      setInventoryBusy(true)
      setInventoryError(undefined)
      setInventorySaveError(undefined)
      setNewCardError(undefined)
      onCardOpening()
      setSavedDocument(undefined)
      setPendingSnapshotCardId(undefined)
      startedSnapshotCardId.current = undefined
      setSavingCard(false)

      void readInventoryCard(cardId)
        .then(async (saved) => {
          if (cancelled) return
          if (!saved) throw new Error("This inventory card does not exist.")
          const loaded = await migrateInventoryCardToCurrentTemplate(saved)
          const storedPreview = await readInventoryPreview(saved.id)
          if (cancelled) return
          inventoryCard.current = loaded
          writeActiveInventoryCardId(loaded.id)
          replaceDocument(loaded.document)
          // A migrated card or a stale preview stays visibly unsaved until its snapshot commits.
          const owesCommit =
            loaded !== saved ||
            !storedPreview ||
            !inventoryPreviewMatchesCard(storedPreview, loaded)
          setPendingSnapshotCardId(owesCommit ? loaded.id : undefined)
          setSavedDocument(owesCommit ? saved.document : loaded.document)
          onCardOpened(loaded.document)
        })
        .catch((error: unknown) => {
          if (!cancelled) setInventoryError(errorMessage(error))
        })
        .finally(() => {
          if (cancelled) return
          setInventoryBusy(false)
          setNewCardBusy(false)
        })
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [cardId, onCardOpened, onCardOpening, replaceDocument, setInventoryBusy])

  useEffect(() => {
    if (!hasUnsavedChanges) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warnBeforeUnload)
    return () => window.removeEventListener("beforeunload", warnBeforeUnload)
  }, [hasUnsavedChanges])

  // Opening a card commits its migration together with a preview rendered from it.
  useEffect(() => {
    const card = inventoryCard.current
    if (!pendingSnapshotCardId || !card || card.id !== pendingSnapshotCardId) return
    if (startedSnapshotCardId.current === pendingSnapshotCardId) return
    if (!bundleRendersDocument(templateBundle, card.document)) return
    startedSnapshotCardId.current = pendingSnapshotCardId
    const token = (snapshotCommitToken.current += 1)
    const active = () => snapshotCommitToken.current === token
    const document = card.document
    setSavingCard(true)
    void (async () => {
      try {
        const image = await renderInventoryPreview(
          document,
          templateBundle,
          await processedInventoryMask(document, templateBundle),
        )
        if (!active()) return
        await saveInventoryCardSnapshot(card, {
          cardId: card.id,
          cardRevision: card.revision,
          image,
        })
        if (active()) setSavedDocument(document)
      } catch (error: unknown) {
        if (active()) setInventorySaveError(errorMessage(error))
      } finally {
        if (active()) setSavingCard(false)
      }
    })()
    return () => {
      snapshotCommitToken.current += 1
    }
  }, [pendingSnapshotCardId, templateBundle])

  async function saveCard() {
    const current = inventoryCard.current
    if (!current || savingCard || !hasUnsavedChanges) return
    if (!bundleRendersDocument(templateBundle, currentDocument)) {
      setInventorySaveError(
        "The active template must finish loading before this card can be saved.",
      )
      return
    }
    const document = currentDocument
    const next = {
      ...current,
      document,
      revision: current.revision + 1,
      title:
        plainTextFromRichText(parseRichText(document.card.name).document).trim() || "Untitled card",
      updatedAt: Date.now(),
    }
    setSavingCard(true)
    setInventorySaveError(undefined)
    try {
      const image = await renderInventoryPreview(
        document,
        templateBundle,
        await processedMaskForDocument(document),
      )
      await saveInventoryCardSnapshot(next, {
        cardId: next.id,
        cardRevision: next.revision,
        image,
      })
      inventoryCard.current = next
      setSavedDocument(document)
    } catch (error: unknown) {
      setInventorySaveError(errorMessage(error))
    } finally {
      setSavingCard(false)
    }
  }

  async function createNewCard() {
    setNewCardBusy(true)
    setNewCardError(undefined)
    try {
      const next = await createInventoryCard(createInitialEditorDocument())
      writeActiveInventoryCardId(next.id)
      await navigate(`/build/${encodeURIComponent(next.id)}`)
    } catch (error: unknown) {
      setNewCardError(errorMessage(error))
      setNewCardBusy(false)
    }
  }

  return {
    createNewCard,
    hasUnsavedChanges,
    inventoryError,
    inventorySaveError,
    inventoryStorageMode: getInventoryStorageMode(),
    newCardBusy,
    newCardError,
    returnToInventory: async () => {
      await navigate("/inventory")
    },
    saveCard,
    savingCard,
  }
}
