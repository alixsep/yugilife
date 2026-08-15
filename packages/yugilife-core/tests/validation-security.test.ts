import { describe, expect, it, vi } from "vitest"

import { renderCard } from "../src"
import { serializeSvgElement } from "../src/svg-export"

import { NAME_FIELD, testTemplateBundle } from "./fixtures"

const baseTemplate = {
  schemaVersion: 1,
  dimensions: { width: 100, height: 150 },
  cardFields: [NAME_FIELD],
  layers: [],
}

describe("template and SVG safety", () => {
  it.each([
    "script",
    "SCRIPT",
    "foreignObject",
    "image",
    "use",
    "a",
    "animate",
    "set",
    "iframe",
    "svg:script",
  ])("rejects active, mixed-case, and namespaced SVG tag %s", (tag) => {
    expect(() => serializeSvgElement({ tag })).toThrow(/supported inert SVG element/)
  })

  it.each(["onload", "OnLoad", "ONCLICK"])("rejects event attribute %s", (attribute) => {
    expect(() =>
      serializeSvgElement({
        tag: "rect",
        attributes: { [attribute]: "alert(1)" },
      }),
    ).toThrow(/event attribute/)
  })

  it.each(["href", "xlink:href", "xmlns:xlink", "style", "clip-path", "class"])(
    "rejects URL, namespace, and style-bearing attribute %s",
    (attribute) => {
      expect(() =>
        serializeSvgElement({
          tag: "rect",
          attributes: { [attribute]: "https://attacker.invalid/payload" },
        }),
      ).toThrow(/unsupported SVG attribute|namespaced attribute/)
    },
  )

  it.each([
    "url(javascript:alert(1))",
    "URL( data:text/html,<script>alert(1)</script> )",
    "url(https://attacker.invalid/image.svg)",
    "url(#local-reference)",
    "javascript:alert(1)",
    "data:image/svg+xml,<svg/>",
    "https://attacker.invalid/style.css",
    "@import 'https://attacker.invalid/style.css'",
    "expression(alert(1))",
    "var(--external-paint)",
    "u\\72l(javascript:alert(1))",
    "u/**/rl(java/**/script:alert(1))",
  ])("rejects active or URL-bearing CSS value %s", (value) => {
    expect(() =>
      serializeSvgElement({
        tag: "rect",
        attributes: { fill: value },
      }),
    ).toThrow(/URL or active CSS content/)
  })

  it("accepts inert presentation-only SVG", () => {
    expect(
      serializeSvgElement({
        tag: "g",
        attributes: { opacity: 0.5, transform: "translate(2 3)" },
        children: [{ tag: "path", attributes: { d: "M0 0h1v1z", fill: "#fff" } }],
      }),
    ).toContain('<path d="M0 0h1v1z" fill="#fff">')
  })

  it("rejects unsafe SVG nested inside an otherwise safe tree", () => {
    expect(() =>
      serializeSvgElement({
        tag: "g",
        children: [{ tag: "g", children: [{ tag: "script", text: "alert(1)" }] }],
      }),
    ).toThrow(/children\[0\]\.children\[0\].*supported inert SVG element/)
  })

  it("rejects unsafe vectors produced by custom renderers", async () => {
    const context = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({} as CanvasRenderingContext2D)
    await expect(
      renderCard(
        { name: "Test" },
        {
          templateBundle: testTemplateBundle({
            ...baseTemplate,
            layers: [{ id: "custom", kind: "custom-vector" }],
          }),
          layerRenderers: {
            "custom-vector": {
              output: "vector",
              render({ vectorLayers }) {
                vectorLayers.push({
                  tag: "g",
                  children: [{ tag: "rect", attributes: { fill: "url(javascript:alert(1))" } }],
                })
              },
            },
          },
        },
      ),
    ).rejects.toThrow(/Rendered vector layer 0\.children\[0\].*URL or active CSS content/)
    context.mockRestore()
  })

  it("stops immediately when rendering is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      renderCard(
        { name: "Test" },
        { signal: controller.signal, templateBundle: testTemplateBundle(baseTemplate) },
      ),
    ).rejects.toMatchObject({ name: "AbortError" })
  })

  it("propagates an explicit abort reason exactly", async () => {
    const controller = new AbortController()
    const reason = new Error("caller stopped rendering")
    controller.abort(reason)

    await expect(
      renderCard(
        { name: "Test" },
        { signal: controller.signal, templateBundle: testTemplateBundle(baseTemplate) },
      ),
    ).rejects.toBe(reason)
  })
})
