import { describe, expect, it } from "vitest"

import { currentEditorDocumentVersion } from "../../migrations/document"
import { createInitialCard, editorTemplateId, editorTemplateVersion } from "../model/editor-config"

import { parseEditorDocument, serializeEditorDocument } from "./editor-document-io"

import type { EditorDocumentState } from "../model/editor-document"

function document(
  identity?: Pick<EditorDocumentState, "templateId" | "templateVersion">,
): EditorDocumentState {
  return {
    artworkMask: { mode: "automatic", points: [] },
    artworkMaskEffects: {},
    card: { ...createInitialCard(), name: "Portable card" },
    layers: { border: false },
    mode: "advanced",
    presetOverrides: {},
    presentationOverrides: {},
    templateId: identity?.templateId ?? editorTemplateId,
    templateVersion: identity?.templateVersion ?? editorTemplateVersion,
  }
}

describe("editor document JSON", () => {
  it("round-trips current card and presentation state", async () => {
    const source = await serializeEditorDocument(document())
    const parsed = parseEditorDocument(source)

    expect(JSON.parse(source)).toMatchObject({
      format: "yugilife/editor-document",
      schemaVersion: currentEditorDocumentVersion,
    })
    expect(parsed).toMatchObject(document())
  })

  it("embeds artwork blobs as portable data URLs", async () => {
    const source = await serializeEditorDocument({
      ...document(),
      card: {
        ...document().card,
        artwork: new File(["art"], "art.png", { type: "image/png" }),
      },
    })
    const parsed = parseEditorDocument(source)

    expect(parsed.card.artwork).toBeInstanceOf(Blob)
    expect(await (parsed.card.artwork as Blob).text()).toBe("art")
  })

  it("round-trips automatic/manual mask assets and editable pins independently", async () => {
    const source = await serializeEditorDocument({
      ...document(),
      artworkMask: {
        automaticMask: new Blob(["auto"], { type: "image/png" }),
        manualMask: new Blob(["manual"], { type: "image/png" }),
        mode: "manual",
        points: [{ id: 1, polarity: "keep", size: 24, x: 10, y: 12 }],
      },
    })
    const parsed = parseEditorDocument(source)

    expect(parsed.artworkMask.mode).toBe("manual")
    expect(parsed.artworkMask.points).toHaveLength(1)
    expect(await parsed.artworkMask.automaticMask?.text()).toBe("auto")
    expect(await parsed.artworkMask.manualMask?.text()).toBe("manual")
  })

  it("preserves a stored user-template identity", async () => {
    const source = await serializeEditorDocument(
      document({ templateId: "user/example", templateVersion: "2026.08.12.1" }),
    )

    expect(parseEditorDocument(source)).toMatchObject({
      templateId: "user/example",
      templateVersion: "2026.08.12.1",
    })
  })

  it("imports pre-split Series 10 documents with the retired Link-arrow mask", () => {
    const parsed = parseEditorDocument(
      JSON.stringify({
        document: {
          ...document(),
          presentationOverrides: {
            layerMasks: {
              artworkOverlay: "full-art-coverage",
              linkArrowLayers: "link-arrows",
            },
          },
          templateVersion: "2026.08.30",
        },
        format: "yugilife/editor-document",
        schemaVersion: currentEditorDocumentVersion,
      }),
    )

    expect(parsed.presentationOverrides.layerMasks).toEqual({
      artworkOverlay: "full-art-coverage",
    })
    expect(parsed.templateVersion).toBe(editorTemplateVersion)
  })

  it("rejects malformed envelopes and unsupported future versions", () => {
    expect(() => parseEditorDocument("not json")).toThrow(/not valid JSON/)
    expect(() =>
      parseEditorDocument(
        JSON.stringify({
          document: document(),
          format: "yugilife/editor-document",
          schemaVersion: currentEditorDocumentVersion + 1,
        }),
      ),
    ).toThrow(/newer than supported/)
  })
})

it.each([
  { artworkMask: null },
  { artworkMask: { mode: "typo", points: [] } },
  { artworkMask: { mode: "automatic", points: "lost pins" } },
  { artworkMask: { mode: "automatic", points: [], automaticMask: 42 } },
  { artworkMask: { mode: "automatic", points: [], unknown: true } },
  { artworkMaskEffects: [] },
  { artworkMaskEffects: null },
  { artworkMask: { mode: "manual", points: [{ id: 1, x: 0, y: 0, size: -4, polarity: "keep" }] } },
])(
  "rejects malformed current-schema mask metadata instead of replacing it with defaults: %j",
  (patch) => {
    expect(() =>
      parseEditorDocument(
        JSON.stringify({
          format: "yugilife/editor-document",
          schemaVersion: currentEditorDocumentVersion,
          document: { ...document(), ...patch },
        }),
      ),
    ).toThrow()
  },
)

it("round-trips the database identity needed to recover removed artwork after reload", async () => {
  const source = { artworkId: 123, cardCid: 456, name: "Example", passcode: "00000123" }
  const doc = document()
  doc.artworkMask.catalogSource = source
  expect(parseEditorDocument(await serializeEditorDocument(doc)).artworkMask.catalogSource).toEqual(
    source,
  )
})
