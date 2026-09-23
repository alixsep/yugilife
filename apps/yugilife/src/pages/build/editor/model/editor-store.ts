import { create } from "zustand"

import {
  createInitialCard,
  createInitialLayerVisibility,
  createInitialPresetOverrides,
  editorLayerIds,
  editorTemplateId,
  editorTemplateVersion,
  isDefaultArtworkTransform,
} from "./editor-config"
import { validateEditorDocumentState } from "./editor-document-validation"

import type { ArtworkMaskEffects, EditorDocumentState, EditorMode } from "./editor-document"
import type {
  ArtworkTransform,
  CardFieldValue,
  TemplateId,
  TextTypographyPatch,
} from "yugilife-core"

export type { EditorMode } from "./editor-document"

interface EditorState extends EditorDocumentState {
  applyCardPatch: (patch: Readonly<Record<string, CardFieldValue>>) => void
  applyCardPatchWithArtworkMask: (
    patch: Readonly<Record<string, CardFieldValue>>,
    artworkMask: EditorDocumentState["artworkMask"],
  ) => void
  replaceDocument: (document: EditorDocumentState) => void
  reset: () => void
  setAllLayers: (visible: boolean) => void
  clearAllPresentationOverrides: () => void
  clearArtworkTransform: (transformId: string) => void
  clearArtworkMaskEffects: (maskField: string) => void
  clearLayerMaskOverride: (layerId: string) => void
  clearLayerOverride: (layerId: string) => void
  clearPresetOverride: (target: string) => void
  clearTextFitProfile: (layerId: string, styleId: string) => void
  clearTextTypography: (layerId: string, styleId: string) => void
  setArtworkTransform: (transformId: string, transform: ArtworkTransform) => void
  setArtworkMaskEffects: (maskField: string, effects: ArtworkMaskEffects) => void
  setArtworkMask: (mask: EditorDocumentState["artworkMask"]) => void
  completeArtworkMask: (
    artwork: Blob,
    points: EditorDocumentState["artworkMask"]["points"],
    manualMask: Blob,
  ) => void
  setField: (name: string, value: CardFieldValue) => void
  setLayer: (id: string, visible: boolean) => void
  setMode: (mode: EditorMode) => void
  setPresetOverride: (target: string, preset: string) => void
  setTextFitProfile: (layerId: string, styleId: string, profileId?: string) => void
  setTextTypography: (layerId: string, styleId: string, patch: EditorTypographyPatch) => void
  setTemplateIdentity: (templateId: TemplateId, templateVersion: string) => void
}

/**
 * An editor-authored typography patch. `undefined` removes a stored override key entirely, which
 * core's `TextTypographyPatch` deliberately disallows for its required properties: core describes a
 * patch that will be persisted and validated, while this describes the edit that produces one. The
 * store strips `undefined` keys, so what reaches storage is always a valid core patch.
 */
export type EditorTypographyPatch = {
  [Key in keyof TextTypographyPatch]?: TextTypographyPatch[Key] | undefined
}

export function createInitialEditorDocument(): EditorDocumentState {
  return {
    artworkMask: { mode: "automatic", points: [] },
    artworkMaskEffects: {},
    card: createInitialCard(),
    layers: createInitialLayerVisibility(),
    mode: "automatic" as const,
    presetOverrides: createInitialPresetOverrides(),
    presentationOverrides: {},
    templateId: editorTemplateId,
    templateVersion: editorTemplateVersion,
  }
}

export const useEditorStore = create<EditorState>()((set) => ({
  ...createInitialEditorDocument(),
  applyCardPatch: (patch) =>
    set((state) => ({
      card: { ...state.card, ...patch },
    })),
  applyCardPatchWithArtworkMask: (patch, artworkMask) =>
    set((state) => ({ artworkMask, card: { ...state.card, ...patch } })),
  replaceDocument: (document) => set(validateEditorDocumentState(document)),
  reset: () => set(createInitialEditorDocument()),
  clearAllPresentationOverrides: () =>
    set({ artworkMaskEffects: {}, layers: {}, presetOverrides: {}, presentationOverrides: {} }),
  clearArtworkTransform: (transformId) =>
    set((state) => {
      const transforms = { ...(state.presentationOverrides.artworkTransforms ?? {}) }
      delete transforms[transformId]
      const presentationOverrides = { ...state.presentationOverrides }
      if (Object.keys(transforms).length === 0) delete presentationOverrides.artworkTransforms
      else presentationOverrides.artworkTransforms = transforms
      return { presentationOverrides }
    }),
  clearArtworkMaskEffects: (maskField) =>
    set((state) => {
      const current = state.artworkMaskEffects
      if (!(maskField in current)) return state
      const next = { ...current }
      delete next[maskField]
      return { artworkMaskEffects: next }
    }),
  clearLayerMaskOverride: (layerId) =>
    set((state) => {
      const current = state.presentationOverrides.layerMasks ?? {}
      if (!(layerId in current)) return state
      const next = { ...current }
      delete next[layerId]
      const presentationOverrides = { ...state.presentationOverrides }
      if (Object.keys(next).length === 0) delete presentationOverrides.layerMasks
      else presentationOverrides.layerMasks = next
      return { presentationOverrides }
    }),
  clearLayerOverride: (layerId) =>
    set((state) => {
      if (!(layerId in state.layers)) return state
      const layers = { ...state.layers }
      delete layers[layerId]
      return { layers }
    }),
  clearPresetOverride: (target) =>
    set((state) => {
      if (!(target in state.presetOverrides)) return state
      const presetOverrides = { ...state.presetOverrides }
      delete presetOverrides[target]
      return { presetOverrides }
    }),
  clearTextFitProfile: (layerId, styleId) =>
    set((state) => {
      const currentProfiles = state.presentationOverrides.textFitProfiles ?? {}
      const currentLayer = currentProfiles[layerId]
      if (!currentLayer || !(styleId in currentLayer)) return state
      const nextLayer = { ...currentLayer }
      delete nextLayer[styleId]
      const nextProfiles = { ...currentProfiles }
      if (Object.keys(nextLayer).length === 0) delete nextProfiles[layerId]
      else nextProfiles[layerId] = nextLayer
      const presentationOverrides = { ...state.presentationOverrides }
      if (Object.keys(nextProfiles).length === 0) delete presentationOverrides.textFitProfiles
      else presentationOverrides.textFitProfiles = nextProfiles
      return { presentationOverrides }
    }),
  clearTextTypography: (layerId, styleId) =>
    set((state) => {
      const currentTypography = state.presentationOverrides.textTypography ?? {}
      const currentLayer = currentTypography[layerId]
      if (!currentLayer || !(styleId in currentLayer)) return state
      const nextLayer = { ...currentLayer }
      delete nextLayer[styleId]
      const nextTypography = { ...currentTypography }
      if (Object.keys(nextLayer).length === 0) delete nextTypography[layerId]
      else nextTypography[layerId] = nextLayer
      const presentationOverrides = { ...state.presentationOverrides }
      if (Object.keys(nextTypography).length === 0) delete presentationOverrides.textTypography
      else presentationOverrides.textTypography = nextTypography
      return { presentationOverrides }
    }),
  setAllLayers: (visible) =>
    set({
      layers: Object.fromEntries([...editorLayerIds].map((id) => [id, visible])),
    }),
  setArtworkTransform: (transformId, transform) =>
    set((state) => {
      const transforms = { ...(state.presentationOverrides.artworkTransforms ?? {}) }
      if (isDefaultArtworkTransform(transform)) delete transforms[transformId]
      else transforms[transformId] = transform
      const presentationOverrides = { ...state.presentationOverrides }
      if (Object.keys(transforms).length === 0) delete presentationOverrides.artworkTransforms
      else presentationOverrides.artworkTransforms = transforms
      return { presentationOverrides }
    }),
  setArtworkMaskEffects: (maskField, effects) =>
    set((state) => {
      const glow =
        effects.glow !== undefined && Number.isFinite(effects.glow)
          ? Math.max(0, Math.min(128, effects.glow))
          : 0
      const normalized = {
        ...(effects.antiAlias === true ? { antiAlias: true } : {}),
        ...(glow > 0 ? { glow } : {}),
      }
      const previous = state.artworkMaskEffects[maskField]
      if (
        (previous?.antiAlias === true) === (normalized.antiAlias === true) &&
        (previous?.glow ?? 0) === (normalized.glow ?? 0)
      )
        return state
      const next = { ...state.artworkMaskEffects }
      if (normalized.antiAlias !== true && (normalized.glow ?? 0) === 0) delete next[maskField]
      else next[maskField] = normalized
      return { artworkMaskEffects: next }
    }),
  setArtworkMask: (artworkMask) =>
    set((state) => ({
      ...(state.card.artworkOverlay ? { card: { ...state.card, artworkOverlay: "" } } : {}),
      artworkMask:
        artworkMask.points === state.artworkMask.points
          ? artworkMask
          : { ...artworkMask, manualMask: undefined },
    })),
  completeArtworkMask: (artwork, points, manualMask) =>
    set((state) => {
      if (state.card.artwork !== artwork || state.artworkMask.points !== points) return state
      return { artworkMask: { ...state.artworkMask, manualMask } }
    }),
  setField: (name, value) =>
    set((state) => ({
      card: { ...state.card, [name]: value },
    })),
  setLayer: (id, visible) =>
    set((state) => ({
      layers: { ...state.layers, [id]: visible },
    })),
  setMode: (mode) => set({ mode }),
  setPresetOverride: (target, preset) =>
    set((state) => ({
      presetOverrides: { ...state.presetOverrides, [target]: preset },
    })),
  setTextFitProfile: (layerId, styleId, profileId) =>
    set((state) => {
      const currentProfiles = state.presentationOverrides.textFitProfiles ?? {}
      const layerProfiles = { ...currentProfiles[layerId] }
      if (profileId) layerProfiles[styleId] = profileId
      else delete layerProfiles[styleId]
      const nextProfiles = { ...currentProfiles }
      if (Object.keys(layerProfiles).length === 0) delete nextProfiles[layerId]
      else nextProfiles[layerId] = layerProfiles
      const presentationOverrides = { ...state.presentationOverrides }
      if (Object.keys(nextProfiles).length === 0) delete presentationOverrides.textFitProfiles
      else presentationOverrides.textFitProfiles = nextProfiles
      return {
        presentationOverrides,
      }
    }),
  setTextTypography: (layerId, styleId, patch) =>
    set((state) => {
      const current = state.presentationOverrides.textTypography ?? {}
      const currentLayer = current[layerId] ?? {}
      const currentPatch = currentLayer[styleId] ?? {}
      const nextPatch: Record<string, unknown> = { ...currentPatch }
      Object.entries(patch).forEach(([key, value]) => {
        if (value === undefined) delete nextPatch[key]
        else nextPatch[key] = value
      })
      const nextLayer = { ...currentLayer }
      if (Object.keys(nextPatch).length === 0) delete nextLayer[styleId]
      else nextLayer[styleId] = nextPatch
      const next = { ...current }
      if (Object.keys(nextLayer).length === 0) delete next[layerId]
      else next[layerId] = nextLayer
      const presentationOverrides = { ...state.presentationOverrides }
      if (Object.keys(next).length === 0) delete presentationOverrides.textTypography
      else presentationOverrides.textTypography = next
      return {
        presentationOverrides,
      }
    }),
  setTemplateIdentity: (templateId, templateVersion) => set({ templateId, templateVersion }),
}))

export const editorSelectors = {
  applyCardPatch: (state: EditorState) => state.applyCardPatch,
  applyCardPatchWithArtworkMask: (state: EditorState) => state.applyCardPatchWithArtworkMask,
  artworkMask: (state: EditorState) => state.artworkMask,
  artworkMaskEffects: (state: EditorState) => state.artworkMaskEffects,
  card: (state: EditorState) => state.card,
  clearAllPresentationOverrides: (state: EditorState) => state.clearAllPresentationOverrides,
  clearArtworkMaskEffects: (state: EditorState) => state.clearArtworkMaskEffects,
  clearArtworkTransform: (state: EditorState) => state.clearArtworkTransform,
  clearLayerMaskOverride: (state: EditorState) => state.clearLayerMaskOverride,
  clearLayerOverride: (state: EditorState) => state.clearLayerOverride,
  clearPresetOverride: (state: EditorState) => state.clearPresetOverride,
  clearTextFitProfile: (state: EditorState) => state.clearTextFitProfile,
  clearTextTypography: (state: EditorState) => state.clearTextTypography,
  layers: (state: EditorState) => state.layers,
  mode: (state: EditorState) => state.mode,
  presetOverrides: (state: EditorState) => state.presetOverrides,
  presentationOverrides: (state: EditorState) => state.presentationOverrides,
  replaceDocument: (state: EditorState) => state.replaceDocument,
  reset: (state: EditorState) => state.reset,
  setAllLayers: (state: EditorState) => state.setAllLayers,
  setArtworkTransform: (state: EditorState) => state.setArtworkTransform,
  setArtworkMaskEffects: (state: EditorState) => state.setArtworkMaskEffects,
  setArtworkMask: (state: EditorState) => state.setArtworkMask,
  completeArtworkMask: (state: EditorState) => state.completeArtworkMask,
  setField: (state: EditorState) => state.setField,
  setLayer: (state: EditorState) => state.setLayer,
  setMode: (state: EditorState) => state.setMode,
  setPresetOverride: (state: EditorState) => state.setPresetOverride,
  setTextFitProfile: (state: EditorState) => state.setTextFitProfile,
  setTextTypography: (state: EditorState) => state.setTextTypography,
  setTemplateIdentity: (state: EditorState) => state.setTemplateIdentity,
  templateId: (state: EditorState) => state.templateId,
  templateVersion: (state: EditorState) => state.templateVersion,
}
