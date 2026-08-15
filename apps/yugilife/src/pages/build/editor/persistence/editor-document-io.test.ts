import { describe, expect, it } from "vitest"

import { currentEditorDocumentVersion } from "../../migrations/document"
import { createInitialCard, editorTemplateId, editorTemplateVersion } from "../model/editor-config"

import { parseEditorDocument, serializeEditorDocument } from "./editor-document-io"

import type { EditorDocumentState } from "../model/editor-document"

function document(
  identity?: Pick<EditorDocumentState, "templateId" | "templateVersion">,
): EditorDocumentState {
  return {
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

    expect(parsed.card.artwork).toBe("data:image/png;base64,YXJ0")
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
