import { describe, expect, it } from "vitest"
import { validateCardTemplate } from "yugilife-core"

import { editorColorPresets, editorTemplate } from "../editor/model/editor-config"

import { templateEditorCompatibility } from "./template-document-io"

describe("template editor compatibility", () => {
  it("allows templates to customize open field suggestions", () => {
    const template = validateCardTemplate({
      ...editorTemplate,
      cardFields: editorTemplate.cardFields.map((field) =>
        field.name === "edition"
          ? { ...field, suggestions: [{ value: "Custom canonical edition" }] }
          : field,
      ),
    })

    expect(templateEditorCompatibility(template, editorColorPresets)).toEqual({ compatible: true })
  })
})
