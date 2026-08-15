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
