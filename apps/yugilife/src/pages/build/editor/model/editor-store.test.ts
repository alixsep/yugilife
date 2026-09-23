import { beforeEach, describe, expect, it } from "vitest"
import { deriveCardSemantics, resolveCardPresentation } from "yugilife-core"

import { editorTemplate } from "./editor-config"
import { useEditorStore } from "./editor-store"

describe("editor presentation override actions", () => {
  beforeEach(() => {
    useEditorStore.getState().reset()
  })

  it("clears one override without changing the card and clears all override categories together", () => {
    const initialCard = useEditorStore.getState().card
    useEditorStore.getState().setLayer("border", false)
    useEditorStore.getState().setPresetOverride("frame", "fusion-frame-s10")
    useEditorStore.getState().setTextFitProfile("description", "default", "small")
    useEditorStore.getState().setTextTypography("description", "default", { fill: "#f00" })

    expect(useEditorStore.getState().layers).toMatchObject({ border: false })
    expect(useEditorStore.getState().presetOverrides).toMatchObject({
      frame: "fusion-frame-s10",
    })
    expect(useEditorStore.getState().presentationOverrides).toMatchObject({
      textFitProfiles: { description: { default: "small" } },
      textTypography: { description: { default: { fill: "#f00" } } },
    })

    useEditorStore.getState().clearLayerOverride("border")
    useEditorStore.getState().clearPresetOverride("frame")
    useEditorStore.getState().clearTextFitProfile("description", "default")
    useEditorStore.getState().clearTextTypography("description", "default")

    expect(useEditorStore.getState().layers).toEqual({})
    expect(useEditorStore.getState().presetOverrides).toEqual({})
    expect(useEditorStore.getState().presentationOverrides).toEqual({})

    useEditorStore.getState().setLayer("border", false)
    useEditorStore.getState().setPresetOverride("frame", "fusion-frame-s10")
    useEditorStore.getState().clearAllPresentationOverrides()

    expect(useEditorStore.getState().card).toEqual(initialCard)
    expect(useEditorStore.getState().layers).toEqual({})
    expect(useEditorStore.getState().presetOverrides).toEqual({})
    expect(useEditorStore.getState().presentationOverrides).toEqual({})
  })

  it("applies a catalog result as one sparse card update", () => {
    const before = useEditorStore.getState()
    before.setField("edition", "Custom edition")
    before.applyCardPatch({
      attack: "2500",
      cardVariant: "effect",
      name: "Catalog Dragon",
    })

    expect(useEditorStore.getState().card).toMatchObject({
      attack: "2500",
      cardVariant: "effect",
      edition: "Custom edition",
      name: "Catalog Dragon",
    })
  })

  it("commits catalog artwork and its mask editing state together", () => {
    const artwork = new Blob(["artwork"], { type: "image/png" })
    const automaticMask = new Blob(["mask"], { type: "image/png" })

    useEditorStore.getState().applyCardPatchWithArtworkMask(
      { artwork, artworkOverlay: "" },
      {
        automaticMask,
        mode: "automatic",
        points: [{ id: 1, polarity: "keep", size: 18, x: 25, y: 75 }],
      },
    )

    const state = useEditorStore.getState()
    expect(state.card.artwork).toBe(artwork)
    expect(state.card.artworkOverlay).toBe("")
    expect(state.artworkMask.automaticMask).toBe(automaticMask)
    expect(state.artworkMask.points).toEqual([{ id: 1, polarity: "keep", size: 18, x: 25, y: 75 }])
  })

  it("persists and clears a sparse automatic-compression override", () => {
    const state = useEditorStore.getState()
    const base = resolveCardPresentation(
      editorTemplate,
      deriveCardSemantics(state.card, editorTemplate),
    ).text.description
    state.setTextTypography("description", base?.styleId ?? "default", {
      maxAutoCompressionX: 0.35,
    })

    const overridden = resolveCardPresentation(
      editorTemplate,
      deriveCardSemantics(state.card, editorTemplate),
      useEditorStore.getState().presentationOverrides,
    ).text.description
    expect(overridden?.typography.maxAutoCompressionX).toBe(0.35)

    useEditorStore.getState().setTextTypography("description", base?.styleId ?? "default", {
      maxAutoCompressionX: undefined,
    })
    expect(useEditorStore.getState().presentationOverrides).toEqual({})
  })

  it("removes an identity artwork transform so reset clears the active-settings warning", () => {
    const state = useEditorStore.getState()
    state.setArtworkTransform("artwork", { scale: 1.4, x: 0.1, y: -0.05 })
    expect(useEditorStore.getState().presentationOverrides).toMatchObject({
      artworkTransforms: { artwork: { scale: 1.4, x: 0.1, y: -0.05 } },
    })

    state.setArtworkTransform("artwork", { scale: 1, x: 0, y: 0 })
    expect(useEditorStore.getState().presentationOverrides).toEqual({})
  })

  it("persists mask edge controls sparsely and removes them at their defaults", () => {
    const state = useEditorStore.getState()
    state.setArtworkMaskEffects("artworkOverlay", { antiAlias: true, glow: 12 })
    expect(useEditorStore.getState().artworkMaskEffects).toMatchObject({
      artworkOverlay: { antiAlias: true, glow: 12 },
    })

    state.setArtworkMaskEffects("artworkOverlay", { antiAlias: false, glow: 0 })
    expect(useEditorStore.getState().artworkMaskEffects).toEqual({})
  })

  it("does not notify or recompute effects when a control submits the same normalized value", () => {
    const state = useEditorStore.getState()
    state.setArtworkMaskEffects("artworkOverlay", { glow: 128 })
    const previous = useEditorStore.getState()
    state.setArtworkMaskEffects("artworkOverlay", { glow: 160, antiAlias: false })
    expect(useEditorStore.getState()).toBe(previous)
  })

  it("can disable and restore leading authored-line fitting without changing card text", () => {
    const description =
      "1 Tuner + 1+ non-Tuner WIND monsters\n(Quick Effect): You can target 1 monster."
    useEditorStore.getState().setField("cardVariant", "fusion")
    useEditorStore.getState().setField("description", description)

    const state = useEditorStore.getState()
    const semantics = deriveCardSemantics(state.card, editorTemplate)
    const base = resolveCardPresentation(editorTemplate, semantics).text.description
    expect(base?.styleId).toBe("extra-deck")
    expect(base?.typography.fitBlocks).toBeDefined()

    state.setTextTypography("description", base?.styleId ?? "extra-deck", { fitBlocks: null })
    const disabled = resolveCardPresentation(
      editorTemplate,
      semantics,
      useEditorStore.getState().presentationOverrides,
    ).text.description
    expect(disabled?.typography).not.toHaveProperty("fitBlocks")
    expect(useEditorStore.getState().card.description).toBe(description)

    useEditorStore
      .getState()
      .setTextTypography("description", base?.styleId ?? "extra-deck", { fitBlocks: undefined })
    expect(useEditorStore.getState().presentationOverrides).toEqual({})
  })
})
