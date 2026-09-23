import { useMemo, useState } from "react"

import { TriangleAlert } from "lucide-react"

import { DashedBorder } from "@/components/ui/dashed-border"
import { Switch } from "@/components/ui/switch"
import { useShape } from "@/lib/shape-context"
import { cn } from "@/lib/utils"

import { ArtworkVariantSelection } from "../../card-catalog/components/artwork-variant-selection"
import { CardCatalogAutocomplete } from "../../card-catalog/components/card-catalog-autocomplete"
import { CatalogArtworkRecovery } from "../../card-catalog/components/catalog-artwork-recovery"
import { artworkEditorConfig, hasArtworkCrop, resetArtworkCrop } from "../model/editor-config"

import { ArtworkEditor, ArtworkFullArtToggle } from "./artwork-editor"
import { CardFieldInput } from "./card-field-input"
import { ActiveOverridesList, EditorAdvancedPanel } from "./editor-advanced-panel"
import { LeadingAuthoredLineFitToggle, TextSizeControl } from "./editor-text-controls"

import type { LoadedCatalogArtworkSet } from "../../card-catalog/components/card-artwork-chooser"
import type { useBuildController } from "../../page/use-build-controller"
import type { ArtworkEditorTool } from "./artwork-editor"
import type { ReactNode } from "react"
import type { CardFieldValue } from "yugilife-core"

interface EditorSidebarProps {
  alphaExportBusy: boolean
  alphaExportReady: boolean
  artworkPinSize: number
  artworkSelectedPinId: number | null
  artworkTool: ArtworkEditorTool
  controller: ReturnType<typeof useBuildController>
  exactBoundsBusy: boolean
  onArtworkPinSizeChange: (size: number) => void
  onArtworkSelectedPinChange: (id: number | null) => void
  onArtworkToolChange: (tool: ArtworkEditorTool) => void
  onDownloadAlphaChannels: () => void
  onShowExactBoundsChange: (visible: boolean) => void
  onShowTextInteractionBoundsChange: (visible: boolean) => void
  showExactBounds: boolean
  showTextInteractionBounds: boolean
}

const fieldPriority = new Map([
  ["name", 0],
  ["cardVariant", 1],
  ["attribute", 2],
])

function EditorSection({
  children,
  description,
  title,
}: {
  children: ReactNode
  description?: string
  title: string
}) {
  return (
    <section className="border-border grid gap-4 border-b p-4 last:border-b-0">
      <div className="grid gap-0.5">
        <h2 className="text-title font-medium">{title}</h2>
        {description && <p className="text-caption text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}

export function EditorSidebar({
  alphaExportBusy,
  alphaExportReady,
  artworkPinSize,
  artworkSelectedPinId,
  artworkTool,
  controller,
  exactBoundsBusy,
  onArtworkPinSizeChange,
  onArtworkSelectedPinChange,
  onArtworkToolChange,
  onDownloadAlphaChannels,
  onShowExactBoundsChange,
  onShowTextInteractionBoundsChange,
  showExactBounds,
  showTextInteractionBounds,
}: EditorSidebarProps) {
  const {
    activeEditorTemplate,
    activeOverrides,
    applyCatalogCardPatch,
    automaticCardFields,
    card,
    cardCatalog,
    cardFields,
    clearActiveOverride,
    clearAllPresentationOverrides,
    defaultPresentation,
    mode,
    presentation,
    presentationOverrides,
    setArtworkMask,
    setArtworkMaskEffects,
    setArtworkTransform,
    setField,
    setMode,
    setTextFitProfile,
    setTextTypography,
    artworkMask,
    artworkMaskEffects,
  } = controller
  const shape = useShape()
  const artworkConfig = artworkEditorConfig(activeEditorTemplate)
  const [removedArtwork, setRemovedArtwork] = useState<{
    image: CardFieldValue
    mask: typeof artworkMask
  }>()
  const [catalogArtworkSet, setCatalogArtworkSet] = useState<LoadedCatalogArtworkSet>()
  const activeCatalogArtworkSet =
    catalogArtworkSet &&
    card.artwork === catalogArtworkSet.artworks.get(catalogArtworkSet.selectedArtworkId)?.image
      ? catalogArtworkSet
      : undefined

  const selectCatalogArtwork = (artworkId: number) => {
    if (!activeCatalogArtworkSet) return
    const artwork = activeCatalogArtworkSet.artworks.get(artworkId)
    if (!artwork) return
    applyCatalogCardPatch(
      { artwork: artwork.image, artworkOverlay: "" },
      {
        catalogSource: {
          artworkId,
          cardCid: activeCatalogArtworkSet.entry.konamiCid!,
          name: activeCatalogArtworkSet.entry.name,
          ...(activeCatalogArtworkSet.entry.passcode
            ? { passcode: activeCatalogArtworkSet.entry.passcode }
            : {}),
        },
        ...(artwork.alphaMask ? { automaticMask: artwork.alphaMask } : {}),
        mode: "automatic",
        points: artwork.maskPoints ?? [],
      },
    )
    setCatalogArtworkSet({ ...activeCatalogArtworkSet, selectedArtworkId: artworkId })
  }

  const setCardField = (name: string, value: CardFieldValue) => {
    if (name === "artwork") {
      if (!value) {
        setRemovedArtwork({ image: card.artwork, mask: artworkMask })
        applyCatalogCardPatch({ artwork: value, artworkOverlay: "" }, artworkMask)
      } else if (value === removedArtwork?.image) {
        applyCatalogCardPatch({ artwork: value, artworkOverlay: "" }, removedArtwork.mask)
        setRemovedArtwork(undefined)
      } else {
        setCatalogArtworkSet(undefined)
        setRemovedArtwork(undefined)
        applyCatalogCardPatch(
          { artwork: value, artworkOverlay: "" },
          { mode: "automatic", points: [] },
        )
      }
      return
    }
    setField(name, value)
  }
  const acceptCatalogArtworkSet = (next: LoadedCatalogArtworkSet | undefined) => {
    setCatalogArtworkSet(next)
  }
  const orderedFields = useMemo(
    () =>
      [...cardFields].sort(
        (left, right) => (fieldPriority.get(left.name) ?? 3) - (fieldPriority.get(right.name) ?? 3),
      ),
    [cardFields],
  )
  const automaticFieldNames = useMemo(
    () => new Set(automaticCardFields.map(({ name }) => name)),
    [automaticCardFields],
  )
  const orderedAutomaticFields = useMemo(
    () => orderedFields.filter(({ name }) => automaticFieldNames.has(name)),
    [automaticFieldNames, orderedFields],
  )
  const orderedAdvancedFields = useMemo(
    () =>
      orderedFields.filter(
        ({ name }) => !automaticFieldNames.has(name) && name !== "artworkOverlay",
      ),
    [automaticFieldNames, orderedFields],
  )
  const renderField = (field: (typeof cardFields)[number]) => {
    const wide =
      field.name === "name" ||
      field.kind === "image" ||
      field.kind === "multiline" ||
      field.kind === "text-list"
    const artworkTransform = presentationOverrides.artworkTransforms?.[
      artworkConfig.transformId
    ] ?? {
      scale: 1,
      x: 0,
      y: 0,
    }
    return (
      <div
        className={cn(
          wide ? "min-w-0 sm:col-span-2" : "min-w-0",
          field.name === "artwork" && "grid gap-4",
        )}
        data-card-field={field.name}
        key={field.name}
      >
        {field.name === "artwork" &&
          activeCatalogArtworkSet &&
          activeCatalogArtworkSet.artworks.size > 1 && (
            <ArtworkVariantSelection
              artworkSet={activeCatalogArtworkSet}
              onSelect={selectCatalogArtwork}
            />
          )}
        <CardFieldInput
          // Full art is a template capability, not a property of the uploaded file: the transform
          // mode is stored independently of the artwork and now also selects the card title's
          // style, so the toggle stays available with the drop zone still empty.
          attachedFooter={
            field.name === "artwork" && artworkConfig.supportsFullArt ? (
              <ArtworkFullArtToggle
                onTransformChange={(transform) =>
                  setArtworkTransform(artworkConfig.transformId, transform)
                }
                transform={artworkTransform}
              />
            ) : undefined
          }
          field={field}
          value={card[field.name]}
          onChange={setCardField}
        />
        {field.name === "artwork" && card.artwork instanceof Blob && (
          <ArtworkEditor
            artwork={card.artwork}
            canResetTransform={hasArtworkCrop(artworkTransform)}
            mask={artworkMask}
            maskEffects={
              artworkConfig.maskField
                ? (artworkMaskEffects[artworkConfig.maskField] ?? {})
                : undefined
            }
            onMaskChange={setArtworkMask}
            onMaskEffectsChange={
              artworkConfig.maskField
                ? (effects) => setArtworkMaskEffects(artworkConfig.maskField!, effects)
                : undefined
            }
            onSelectedPinChange={onArtworkSelectedPinChange}
            onPinSizeChange={onArtworkPinSizeChange}
            onResetTransform={() =>
              setArtworkTransform(artworkConfig.transformId, resetArtworkCrop(artworkTransform))
            }
            onToolChange={onArtworkToolChange}
            onTransformChange={(transform) =>
              setArtworkTransform(artworkConfig.transformId, transform)
            }
            pinSize={artworkPinSize}
            selectedPinId={artworkSelectedPinId}
            tool={artworkTool}
            transform={artworkTransform}
          />
        )}
        {field.name === "artwork" && (
          <CatalogArtworkRecovery
            key={artworkMask.catalogSource?.artworkId ?? "none"}
            mask={artworkMask}
            applyPatch={applyCatalogCardPatch}
            onMaskChange={setArtworkMask}
          />
        )}
        {field.automaticFitLayer && (
          <div className="mt-2 grid gap-2">
            <TextSizeControl
              label={`${field.label} size`}
              layerId={field.automaticFitLayer}
              presentation={presentation}
              setTextFitProfile={setTextFitProfile}
            />
            {mode === "automatic" && (
              <LeadingAuthoredLineFitToggle
                defaultPresentation={defaultPresentation}
                layerId={field.automaticFitLayer}
                presentation={presentation}
                setTextTypography={setTextTypography}
                value={card[field.name]}
              />
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <aside className="grid content-start" aria-label="Card editor">
      {activeOverrides.length > 0 && (
        <div
          aria-live="polite"
          className={cn(
            "bg-warning-light relative mx-4 mt-4 overflow-hidden px-3 py-2",
            shape.container,
          )}
          role="status"
        >
          <DashedBorder className="text-warning" />
          <div className="grid min-w-0 gap-0.5">
            <div className="flex min-w-0 items-center gap-2">
              <TriangleAlert aria-hidden="true" className="text-warning size-4 flex-none" />
              <p className="text-body min-w-0 font-medium">Custom settings are active</p>
            </div>
            <p className="text-caption">
              {activeOverrides.length === 1
                ? "One presentation choice is taking priority over the template defaults."
                : `${activeOverrides.length} presentation choices are taking priority over the template defaults.`}
            </p>
          </div>
        </div>
      )}

      <EditorSection title="Card details" description="Everything printed on the card.">
        <CardCatalogAutocomplete
          applyPatch={applyCatalogCardPatch}
          catalog={cardCatalog}
          onArtworkSetChange={acceptCatalogArtworkSet}
        />
        <div className="grid grid-cols-1 gap-x-3 gap-y-4 sm:grid-cols-2">
          {orderedAutomaticFields.map(renderField)}
        </div>
      </EditorSection>

      <section className="border-border grid gap-4 border-b p-4 last:border-b-0">
        <div className="grid min-w-0 gap-0.5">
          <div className="flex items-center gap-3">
            <h2 className="text-title font-medium">Advanced mode</h2>
            <Switch
              checked={mode === "advanced"}
              hideLabel
              label="Advanced mode"
              onToggle={() => setMode(mode === "advanced" ? "automatic" : "advanced")}
            />
          </div>
          <p className="text-caption text-muted-foreground">
            Control typography, appearance, and individual layers when the automatic choices need
            adjustment.
          </p>
        </div>

        {/* Overrides outlive the switch back to Automatic, so they sit with the switch itself rather
          than inside the advanced categories: the way out of them must not require turning Advanced
          mode on again. */}
        {activeOverrides.length > 0 && (
          <div className="border-border border-t pt-4">
            <ActiveOverridesList
              activeOverrides={activeOverrides}
              clearActiveOverride={clearActiveOverride}
              clearAllPresentationOverrides={clearAllPresentationOverrides}
            />
          </div>
        )}

        {mode === "advanced" ? (
          <EditorAdvancedPanel
            alphaExportBusy={alphaExportBusy}
            alphaExportReady={alphaExportReady}
            controller={controller}
            exactBoundsBusy={exactBoundsBusy}
            onDownloadAlphaChannels={onDownloadAlphaChannels}
            onShowExactBoundsChange={onShowExactBoundsChange}
            onShowTextInteractionBoundsChange={onShowTextInteractionBoundsChange}
            showExactBounds={showExactBounds}
            showTextInteractionBounds={showTextInteractionBounds}
          />
        ) : (
          <p className="text-caption text-muted-foreground">
            Automatic mode is active. The template is balancing type, textures, and layer choices as
            the card changes.
          </p>
        )}
      </section>

      {/* Card data, not presentation, so these sit apart from the advanced categories — and last,
        since they only matter once the card type stops using them. Always expanded: Build deep-links
        to a field by switching to Advanced mode and scrolling to it, which a collapsed panel would
        defeat. */}
      {mode === "advanced" && orderedAdvancedFields.length > 0 && (
        <EditorSection
          description="Automatic mode hides them. Their values stay saved with the card either way."
          title="Fields this card does not use"
        >
          <div className="grid grid-cols-1 gap-x-3 gap-y-4 sm:grid-cols-2">
            {orderedAdvancedFields.map(renderField)}
          </div>
        </EditorSection>
      )}
    </aside>
  )
}
