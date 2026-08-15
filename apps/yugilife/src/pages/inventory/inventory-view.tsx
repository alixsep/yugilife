import { useState } from "react"

import { GalleryVerticalEnd, Pencil, Trash2, TriangleAlert } from "lucide-react"
import { Link } from "react-router"

import { AppNavigation } from "@/components/app-navigation"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Tooltip } from "@/components/ui/tooltip"
import { Elevated } from "@/lib/elevated"
import { useShape } from "@/lib/shape-context"

import { InventoryCarousel } from "./inventory-carousel"

import type { useInventoryController } from "./use-inventory-controller"

interface InventoryViewProps {
  controller: ReturnType<typeof useInventoryController>
}

export function InventoryView({ controller }: InventoryViewProps) {
  const shape = useShape()
  const [createCardFocused, setCreateCardFocused] = useState(false)
  const {
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
    storageMode,
  } = controller

  return (
    <main className="inventory-page bg-background text-foreground relative flex h-dvh flex-col overflow-hidden">
      <AppNavigation />

      <div className="relative min-h-0 w-full flex-1">
        <div className="relative size-full min-h-0 overflow-hidden">
          <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center text-center">
            <div className="min-w-0 px-3">
              <h1 className="text-[clamp(1.35rem,3vw,2.15rem)] leading-none font-medium tracking-[-0.035em]">
                Inventory
              </h1>
              <p className="text-caption text-muted-foreground mt-1.5">
                {cards.length} {cards.length === 1 ? "card" : "cards"}
                {storageMode === "memory" ? " · Session only" : ""}
              </p>
            </div>
          </header>

          {error && (
            <Elevated
              className={`${shape.container} border-destructive/20 bg-destructive-light absolute top-20 left-1/2 z-40 flex max-w-[min(28rem,calc(100%-1rem))] -translate-x-1/2 items-start gap-2 border px-3 py-2`}
              offset={1}
            >
              <TriangleAlert
                aria-hidden="true"
                className="text-destructive mt-0.5 size-4 shrink-0"
              />
              <p className="text-body" role="alert">
                {error}
              </p>
            </Elevated>
          )}

          {busy && cards.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center" role="status">
              <div className="flex items-center gap-3">
                <span
                  className={`${shape.container} bg-surface-2 shadow-surface-4 block aspect-[813/1185] h-28 animate-pulse`}
                />
                <span className="text-body text-muted-foreground">Opening your collection…</span>
              </div>
            </div>
          ) : (
            <>
              <InventoryCarousel
                busy={busy}
                cards={cards}
                key={selectedCardId ?? "empty-inventory"}
                onCreate={() => void createCard()}
                onCreateFocusChange={setCreateCardFocused}
                onSelect={setSelectedCardId}
                previewUrls={previewUrls}
                selectedCardId={selectedCardId}
              />

              {(selectedCard || createCardFocused || cards.length === 0) && (
                <footer className="absolute inset-x-2 bottom-2 z-40 flex justify-center sm:inset-x-4 sm:bottom-4">
                  <Elevated
                    className={`${shape.container} border-border flex w-full max-w-2xl flex-col items-stretch gap-2.5 border px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4 sm:py-2`}
                    offset={1}
                    shadowLevel={3}
                  >
                    {createCardFocused || !selectedCard ? (
                      <div className="min-w-0 text-center sm:text-left">
                        <h2 className="text-title font-medium">New card</h2>
                        <p className="text-caption text-muted-foreground mt-0.5">
                          Click the plus card to create a blank card and open it in Build.
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="min-w-0 text-center sm:text-left">
                          <h2 className="text-title truncate font-medium">{selectedCard.title}</h2>
                          <p className="text-caption text-muted-foreground mt-0.5 truncate">
                            <span className="hidden sm:inline">{selectedCard.templateId} · </span>
                            Updated{" "}
                            {new Date(selectedCard.updatedAt).toLocaleDateString(undefined, {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </p>
                        </div>

                        <div className="flex w-full shrink-0 items-center gap-1 sm:w-auto">
                          <Button
                            asChild
                            className="flex-1 sm:flex-none"
                            leadingIcon={Pencil}
                            variant="primary"
                          >
                            <Link to={`/build/${encodeURIComponent(selectedCard.id)}`}>
                              Edit card
                            </Link>
                          </Button>
                          <Tooltip content="Duplicate card" side="top">
                            <Button
                              aria-label="Duplicate card"
                              className="px-2 sm:px-4"
                              disabled={busy}
                              leadingIcon={GalleryVerticalEnd}
                              onClick={() => void duplicateCard(selectedCard.id)}
                              variant="ghost"
                            >
                              <span className="hidden sm:inline">Duplicate</span>
                            </Button>
                          </Tooltip>
                          <ConfirmDialog
                            confirmLabel="Delete card"
                            description={`“${selectedCard.title}” will be permanently removed from this browser.`}
                            disabled={busy}
                            onConfirm={() => void deleteCard(selectedCard.id)}
                            title="Delete this card?"
                            trigger={
                              <Button
                                aria-label="Delete card"
                                className="text-destructive hover:text-destructive"
                                size="icon"
                                variant="ghost"
                              >
                                <Trash2 />
                              </Button>
                            }
                          />
                        </div>
                      </>
                    )}
                  </Elevated>
                </footer>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  )
}
