import { afterEach, describe, expect, it, vi } from "vitest"

import { serializeCardSvg } from "../src/svg-export"

import { NAME_FIELD } from "./fixtures"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("SVG export document", () => {
  it("serializes ordered segments and marks an explicit font-dependent text mode", () => {
    const canvas = {
      toDataURL: () => "data:image/png;base64,cmFzdGVy",
    } as HTMLCanvasElement
    const svg = serializeCardSvg(
      {
        schemaVersion: 1,
        dimensions: { width: 100, height: 150 },
        cardFields: [NAME_FIELD],
        layers: [],
      },
      [
        { canvas, kind: "raster" },
        {
          elements: [
            {
              tag: "text",
              attributes: { x: 10, y: 20 },
              text: "Vector name",
            },
          ],
          kind: "vector",
        },
      ],
      { textMode: "text" },
    )

    expect(svg.match(/<image /g)).toHaveLength(1)
    expect(svg.indexOf("<image ")).toBeLessThan(svg.indexOf("<text "))
    expect(svg).toContain("data:image/png;base64,cmFzdGVy")
    expect(svg).not.toContain("<canvas")
    expect(svg).toContain("<?xml")
    expect(svg).toContain('data-yugilife-text-mode="text"')
  })

  it("rejects an unsupported text mode received from untyped JavaScript", () => {
    expect(() =>
      serializeCardSvg(
        {
          schemaVersion: 1,
          dimensions: { width: 100, height: 150 },
          cardFields: [NAME_FIELD],
          layers: [],
        },
        [],
        { textMode: "pixels" } as never,
      ),
    ).toThrow(/Unsupported SVG text mode "pixels"/)
  })

  it("serializes outlined path mode only when no live SVG text remains", () => {
    const template = {
      schemaVersion: 1,
      dimensions: { width: 100, height: 150 },
      cardFields: [NAME_FIELD],
      layers: [],
    } as const
    const svg = serializeCardSvg(
      template,
      [
        {
          elements: [{ attributes: { d: "M0 0L1 1Z", fill: "#000" }, tag: "path" }],
          kind: "vector",
        },
      ],
      { textMode: "paths" },
    )

    expect(svg).toContain('data-yugilife-text-mode="paths"')
    expect(svg).toContain('<path d="M0 0L1 1Z" fill="#000"></path>')
    expect(svg).not.toContain("<text")

    expect(() =>
      serializeCardSvg(
        template,
        [{ elements: [{ tag: "text", text: "Still live" }], kind: "vector" }],
        { textMode: "paths" },
      ),
    ).toThrow(/cannot serialize residual <text>/)
  })

  it("encodes every transparent raster intermediate as PNG without mutating it", () => {
    const toDataURL = vi.fn(() => "data:image/png;base64,cmFzdGVy")
    const first = { toDataURL } as unknown as HTMLCanvasElement
    const second = { toDataURL } as unknown as HTMLCanvasElement

    const svg = serializeCardSvg(
      {
        schemaVersion: 1,
        dimensions: { width: 100, height: 150 },
        cardFields: [NAME_FIELD],
        layers: [],
      },
      [
        { canvas: first, kind: "raster" },
        { elements: [{ tag: "text", text: "Between" }], kind: "vector" },
        { canvas: second, kind: "raster" },
      ],
      { textMode: "text" },
    )

    expect(svg.match(/<image /g)).toHaveLength(2)
    expect(toDataURL).toHaveBeenNthCalledWith(1, "image/png")
    expect(toDataURL).toHaveBeenNthCalledWith(2, "image/png")
  })

  it("flattens contiguous raster segments without crossing vector content", () => {
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,flattened",
    )
    const firstToDataURL = vi.fn()
    const secondToDataURL = vi.fn()
    const lastToDataURL = vi.fn(() => "data:image/png;base64,last")
    const first = { toDataURL: firstToDataURL } as unknown as HTMLCanvasElement
    const second = { toDataURL: secondToDataURL } as unknown as HTMLCanvasElement
    const last = { toDataURL: lastToDataURL } as unknown as HTMLCanvasElement
    const template = {
      schemaVersion: 1,
      dimensions: { width: 100, height: 150 },
      cardFields: [NAME_FIELD],
      layers: [],
    } as const

    const svg = serializeCardSvg(
      template,
      [
        { canvas: first, kind: "raster" },
        { canvas: second, kind: "raster" },
        { elements: [{ tag: "path", attributes: { d: "M0 0L1 1Z" } }], kind: "vector" },
        { canvas: last, kind: "raster" },
      ],
      { textMode: "text" },
    )

    expect(svg.match(/<image /g)).toHaveLength(2)
    expect(svg).toContain("data:image/png;base64,flattened")
    expect(drawImage).toHaveBeenCalledTimes(2)
    expect(drawImage).toHaveBeenNthCalledWith(1, first, 0, 0, 100, 150)
    expect(drawImage).toHaveBeenNthCalledWith(2, second, 0, 0, 100, 150)
    expect(firstToDataURL).not.toHaveBeenCalled()
    expect(secondToDataURL).not.toHaveBeenCalled()
    expect(lastToDataURL).toHaveBeenCalledWith("image/png")
  })
})
