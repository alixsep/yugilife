import { useEffect, useMemo, useRef, useState } from "react"

import { CloudOff, Database, DatabaseZap, RefreshCw, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Combobox } from "@/components/ui/combobox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Progress } from "@/components/ui/progress"
import { Tooltip } from "@/components/ui/tooltip"

import { loadCardArtworks } from "../model/card-artwork-loader"
import { cardCatalogArtworkPatch, cardCatalogEntryPatch } from "../model/card-catalog"

import type { ArtworkMaskEditingState } from "../../editor/model/editor-document"
import type { CardArtworksLoadProgress, LoadedCardArtwork } from "../model/card-artwork-loader"
import type { CardCatalogEntry } from "../model/card-catalog"
import type { CardCatalogSearchClient } from "../model/card-catalog-loader"
import type { CardCatalogManager, CardCatalogManagerState } from "../model/use-card-catalog"
import type { LoadedCatalogArtworkSet } from "./card-artwork-chooser"
import type { CardFieldValue } from "yugilife-core"

interface CardCatalogAutocompleteProps {
  applyPatch: (
    patch: Readonly<Record<string, CardFieldValue>>,
    artworkMask: ArtworkMaskEditingState,
  ) => void
  catalog: CardCatalogManager
  onArtworkSetChange: (artworkSet: LoadedCatalogArtworkSet | undefined) => void
}

function entryIdentifier(entry: CardCatalogEntry) {
  if (entry.passcode) return entry.passcode
  if (entry.konamiCid !== undefined) return `CID ${entry.konamiCid}`
  return `Source ${entry.sourceId}`
}

function progressMessage(state: Extract<CardCatalogManagerState, { status: "loading" }>) {
  switch (state.progress.phase) {
    case "checking":
      return "Checking for card catalog updates…"
    case "downloading": {
      const percent =
        state.progress.totalBytes === 0
          ? 0
          : Math.min(
              100,
              Math.round((state.progress.loadedBytes / state.progress.totalBytes) * 100),
            )
      return `Downloading card catalog… ${percent}%`
    }
    case "decoding":
      return "Opening downloaded card catalog…"
    case "validating":
      return "Verifying card catalog…"
  }
}

function emptyMessage(state: CardCatalogManagerState, searching: boolean, searchFailed: boolean) {
  switch (state.status) {
    case "idle":
      return "Download the card catalog to start searching."
    case "restoring":
      return "Opening the saved card catalog…"
    case "loading":
      return "Card catalog is downloading…"
    case "error":
      return "Card catalog is unavailable."
    case "ready":
      if (searching) return "Searching…"
      if (searchFailed) return "Card catalog search failed."
      return "No matching cards."
  }
}

function actionLabel(state: CardCatalogManagerState) {
  switch (state.status) {
    case "idle":
      return "Download card catalog"
    case "restoring":
      return "Opening saved card catalog"
    case "loading":
      return "Updating card catalog"
    case "error":
      return "Retry card catalog"
    case "ready":
      return state.source === "network"
        ? "Card catalog updated — check again"
        : state.source === "offline-cache"
          ? "Saved card catalog in use — try updating again"
          : "Card catalog is up to date — check again"
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * The loader owns the arithmetic, because only it knows how many files a batch will fetch. This
 * only words the result, split so the stage reads on the left and its numbers sit on the right.
 */
function artworkProgressStatus(count: number, progress: CardArtworksLoadProgress | undefined) {
  const artworks = `${count} artwork${count === 1 ? "" : "s"}`
  if (!progress) return { label: `Preparing ${artworks}` }
  if (progress.verifying) return { label: `Authenticating ${artworks}` }
  return {
    label: `Downloading ${artworks}`,
    value: `${Math.round(progress.ratio * 100)}% · ${formatBytes(progress.loadedBytes)}`,
  }
}

export function CardCatalogAutocomplete({
  applyPatch,
  catalog,
  onArtworkSetChange,
}: CardCatalogAutocompleteProps) {
  const activeArtworkRequest = useRef<AbortController | undefined>(undefined)
  const [applyError, setApplyError] = useState<string>()
  const [applyWarning, setApplyWarning] = useState<string>()
  const [applying, setApplying] = useState(false)
  const [artworkProgress, setArtworkProgress] = useState<CardArtworksLoadProgress>()
  const [pendingSelection, setPendingSelection] = useState<{
    entry: CardCatalogEntry
    previousQuery: string
  }>()
  const [query, setQuery] = useState("")
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [searchResult, setSearchResult] = useState<{
    error: string | undefined
    query: string
    search: CardCatalogSearchClient
    suggestions: readonly CardCatalogEntry[]
  }>()

  useEffect(() => {
    const search = catalog.state.status === "ready" ? catalog.state.search : undefined
    if (!search || !query.trim()) return

    let cancelled = false
    const timeout = window.setTimeout(() => {
      void search
        .search(query)
        .then((results) => {
          if (cancelled) return
          setSearchResult({
            error: undefined,
            query,
            search,
            suggestions: results,
          })
        })
        .catch((error: unknown) => {
          if (cancelled) return
          setSearchResult({
            error: error instanceof Error ? error.message : "The card catalog search failed.",
            query,
            search,
            suggestions: [],
          })
        })
    }, 80)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [catalog.state, query])
  useEffect(
    () => () => {
      activeArtworkRequest.current?.abort()
    },
    [],
  )
  const currentSearchResult =
    catalog.state.status === "ready" &&
    query.trim() &&
    searchResult?.search === catalog.state.search
      ? searchResult
      : undefined
  const searchError = currentSearchResult?.query === query ? currentSearchResult.error : undefined
  const searching =
    catalog.state.status === "ready" && query.trim().length > 0 && currentSearchResult === undefined
  const items = useMemo(
    () =>
      (currentSearchResult?.suggestions ?? []).map((entry) => ({
        keywords: [
          String(entry.sourceId),
          entry.passcode ?? "",
          entry.konamiCid === undefined ? "" : String(entry.konamiCid),
        ],
        label: entry.name,
        meta: entryIdentifier(entry),
        value: entry,
      })),
    [currentSearchResult],
  )

  const requestSelection = (entry: CardCatalogEntry | null) => {
    if (!entry) return
    setCatalogOpen(false)
    activeArtworkRequest.current?.abort()
    setApplyError(undefined)
    setApplyWarning(undefined)
    setArtworkProgress(undefined)
    setApplying(false)
    setPendingSelection({ entry, previousQuery: query })
  }

  const cancelSelection = () => {
    activeArtworkRequest.current?.abort()
    activeArtworkRequest.current = undefined
    if (pendingSelection) setQuery(pendingSelection.previousQuery)
    setApplying(false)
    setArtworkProgress(undefined)
    setPendingSelection(undefined)
  }

  const confirmSelection = async (artworkOnly = false) => {
    if (!pendingSelection || applying) return
    const selection = pendingSelection

    const controller = new AbortController()
    activeArtworkRequest.current = controller
    setApplyError(undefined)
    setArtworkProgress(undefined)
    setApplying(true)
    try {
      let downloadedArtworks: ReadonlyMap<number, LoadedCardArtwork> = new Map()
      let missingArtworkIds: readonly number[] = []
      if (selection.entry.artworkIds.length > 0) {
        const cardCid = selection.entry.konamiCid
        if (cardCid === undefined) {
          throw new Error("This artwork cannot be verified because the card has no Konami CID.")
        }
        const result = await loadCardArtworks(
          {
            artworkIds: selection.entry.artworkIds,
            cardCid,
            name: selection.entry.name,
            ...(selection.entry.passcode ? { passcode: selection.entry.passcode } : {}),
          },
          {
            onProgress: (progress) => {
              if (activeArtworkRequest.current !== controller) return
              setArtworkProgress(progress)
            },
            signal: controller.signal,
          },
        )
        downloadedArtworks = result.artworks
        missingArtworkIds = result.missingArtworkIds
      }
      if (controller.signal.aborted || activeArtworkRequest.current !== controller) return
      const initialArtworkId = selection.entry.artworkIds.find((artworkId) =>
        downloadedArtworks.has(artworkId),
      )
      const initialArtwork =
        initialArtworkId === undefined ? undefined : downloadedArtworks.get(initialArtworkId)
      if (initialArtworkId !== undefined && initialArtwork === undefined) {
        throw new Error("The default artwork was not downloaded successfully.")
      }
      if (artworkOnly && !initialArtwork) {
        throw new Error(
          "No artwork is available for this card yet. Your existing artwork and masks were kept.",
        )
      }
      // An empty artwork field is the card's "no image" value, so a card with no mapped or
      // available artwork applies with it cleared rather than failing.
      const artwork = initialArtwork?.image ?? ""
      // Provenance records the requested identity even when its file is not hosted yet, so a later
      // restore can retry the same artwork.
      const catalogArtworkId = initialArtworkId ?? selection.entry.artworkIds[0]
      applyPatch(
        artworkOnly
          ? cardCatalogArtworkPatch(artwork)
          : cardCatalogEntryPatch(selection.entry, artwork, ""),
        {
          ...(initialArtwork?.alphaMask ? { automaticMask: initialArtwork.alphaMask } : {}),
          ...(selection.entry.konamiCid !== undefined && catalogArtworkId !== undefined
            ? {
                catalogSource: {
                  artworkId: catalogArtworkId,
                  cardCid: selection.entry.konamiCid,
                  name: selection.entry.name,
                  ...(selection.entry.passcode ? { passcode: selection.entry.passcode } : {}),
                },
              }
            : {}),
          mode: "automatic",
          points: initialArtwork?.maskPoints ?? [],
        },
      )
      onArtworkSetChange(
        downloadedArtworks.size > 0 && initialArtworkId !== undefined
          ? {
              artworks: downloadedArtworks,
              entry: selection.entry,
              selectedArtworkId: initialArtworkId,
            }
          : undefined,
      )
      setQuery(selection.entry.name)
      setApplyError(undefined)
      setApplyWarning(
        missingArtworkIds.length === 0
          ? undefined
          : downloadedArtworks.size === 0
            ? `Artwork is not available for “${selection.entry.name}” yet. Card details were applied and artwork was left empty.`
            : `${missingArtworkIds.length} artwork variant${missingArtworkIds.length === 1 ? " is" : "s are"} not available yet. The available variants were loaded.`,
      )
      setPendingSelection(undefined)
    } catch (error: unknown) {
      controller.abort()
      if (activeArtworkRequest.current !== controller) return
      setApplyError(
        error instanceof Error ? error.message : "This catalog card could not be applied.",
      )
    } finally {
      if (activeArtworkRequest.current === controller) {
        activeArtworkRequest.current = undefined
        setApplying(false)
        setArtworkProgress(undefined)
      }
    }
  }

  const artworkStatus = artworkProgressStatus(
    pendingSelection?.entry.artworkIds.length ?? 0,
    artworkProgress,
  )

  const statusMessage =
    applyWarning ??
    (catalog.state.status === "loading"
      ? progressMessage(catalog.state)
      : catalog.state.status === "ready"
        ? catalog.state.warning
        : undefined)
  const fieldDescription =
    statusMessage ??
    (catalog.state.status === "restoring"
      ? "Opening the verified card catalog saved in this browser."
      : catalog.state.status === "idle"
        ? "Download the card catalog to search by card name or passcode."
        : undefined)
  const fieldError =
    catalog.state.status === "error"
      ? `${catalog.state.message} You can continue editing the card manually.`
      : applyError
        ? `${applyError} No card fields were changed.`
        : searchError
  const loading = catalog.state.status === "loading" || catalog.state.status === "restoring"
  const searchEnabled = catalog.state.status === "ready"
  const StatusIcon =
    catalog.state.status === "idle" || catalog.state.status === "restoring"
      ? Database
      : catalog.state.status === "ready"
        ? catalog.state.source === "offline-cache"
          ? CloudOff
          : catalog.state.source === "network"
            ? DatabaseZap
            : Database
        : catalog.state.status === "error"
          ? RotateCcw
          : RefreshCw
  const catalogActionLabel = actionLabel(catalog.state)
  const handleQueryChange = (next: string) => {
    setQuery(next)
    setCatalogOpen(next.trim().length > 0)
    // The warning describes the previous apply; a new search is the end of that interaction.
    setApplyWarning(undefined)
  }
  /**
   * Reloading leaves the ready state, so the popup closes here rather than in an effect watching
   * for that transition: a stale `catalogOpen` would otherwise reopen the list by itself when the
   * catalog becomes ready again with text still in the field.
   */
  const handleCatalogReload = () => {
    setCatalogOpen(false)
    catalog.load()
  }
  const handleCatalogOpenChange = (open: boolean, details: { reason: string }) => {
    if (details.reason === "input-change") {
      setCatalogOpen(open)
      return
    }
    setCatalogOpen(open && query.trim().length > 0)
  }

  return (
    <>
      <Field
        invalid={
          catalog.state.status === "error" || applyError !== undefined || searchError !== undefined
        }
      >
        <FieldLabel>Find a card</FieldLabel>
        <div className="flex min-w-0 items-start gap-2">
          <Combobox
            className="min-w-0 flex-1"
            disabled={!searchEnabled}
            emptyMessage={emptyMessage(catalog.state, searching, searchError !== undefined)}
            filter={() => true}
            inputValue={query}
            isItemEqual={(left, right) => left.sourceId === right.sourceId}
            itemKey={({ value: entry }) => String(entry.sourceId)}
            items={items}
            placeholder="Search card name or passcode…"
            open={catalogOpen && searchEnabled && query.trim().length > 0}
            trailingIcon="search"
            onInputValueChange={handleQueryChange}
            onOpenChange={handleCatalogOpenChange}
            onValueChange={requestSelection}
          />
          <Tooltip content={catalogActionLabel}>
            <Button
              aria-label={catalogActionLabel}
              loading={loading}
              size="icon"
              type="button"
              variant="tertiary"
              onClick={handleCatalogReload}
            >
              <StatusIcon />
            </Button>
          </Tooltip>
        </div>
        {fieldDescription && (
          <FieldDescription
            aria-live="polite"
            className={applyWarning === undefined ? undefined : "text-warning"}
          >
            {fieldDescription}
          </FieldDescription>
        )}
        {fieldError && <FieldError>{fieldError}</FieldError>}
      </Field>

      <Dialog
        open={pendingSelection !== undefined}
        onOpenChange={(open) => {
          if (!open) cancelSelection()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply this catalog card?</DialogTitle>
            <DialogDescription>
              {pendingSelection
                ? `Applying “${pendingSelection.entry.name}” replaces supported card fields, downloads all ${pendingSelection.entry.artworkIds.length || "available"} mapped artwork${pendingSelection.entry.artworkIds.length === 1 ? "" : "s"}, and clears the existing overlay, edition, and set code. Your copyright text, sticker, and presentation settings stay unchanged.`
                : "Applying this result replaces supported card fields and clears card-specific values."}
            </DialogDescription>
          </DialogHeader>
          <p className="text-caption text-muted-foreground">
            Use artwork only replaces artwork and masks while preserving every card text field. It
            also remembers the database source for later restoration.
          </p>
          {pendingSelection?.entry.artworkIds.length === 0 && (
            <p className="text-caption text-muted-foreground">
              No hosted artwork is mapped to this card. Its artwork field will be cleared.
            </p>
          )}
          {applying && (
            <div aria-live="polite" className="grid gap-2" role="status">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-caption truncate font-medium">{artworkStatus.label}</span>
                {artworkStatus.value && (
                  <span className="text-caption text-muted-foreground shrink-0 tabular-nums">
                    {artworkStatus.value}
                  </span>
                )}
              </div>
              <Progress label="Downloading card artworks" max={1} value={artworkProgress?.ratio} />
            </div>
          )}
          {applyError && <FieldError>{applyError} No card fields were changed.</FieldError>}
          <DialogFooter>
            {/* Labels stay fixed across the idle and downloading states: a footer whose buttons
                grow mid-apply either wraps into ragged rows or reflows under the pointer. The
                download state is already carried by the progress bar and the primary spinner. */}
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              disabled={applying}
              variant="tertiary"
              onClick={() => void confirmSelection(true)}
            >
              Use artwork only
            </Button>
            <Button loading={applying} onClick={() => void confirmSelection()}>
              Apply card
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
