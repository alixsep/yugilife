import { describe, expect, it } from "vitest"

import { measureTextWidth } from "../src/rendering/default-renderers"
import { createTextElement } from "../src/rendering/vector"
import { serializeSvgElement } from "../src/svg-export"

describe("vector text fitting", () => {
  it("preserves a leading zero in text fields", () => {
    const element = createTextElement(
      { name: "Card", serialNumber: "01111111" },
      {
        field: "serialNumber",
        id: "serialNumber",
        kind: "text",
        position: { x: 10, y: 20 },
        typography: { fill: "#000", fontFamily: "Test", fontSize: 20 },
      },
    )

    expect(element.text).toBe("01111111")
  })

  it("omits an empty type-list instead of serializing it as brackets", () => {
    const element = createTextElement(
      { name: "", types: [] },
      {
        field: "types",
        format: "type-list",
        id: "types",
        kind: "text",
        position: { x: 10, y: 20 },
        typography: { fill: "#000", fontFamily: "Test", fontSize: 20 },
      },
    )

    expect(element.text).toBe("")
  })

  it("keeps empty number-pair slots aligned with their declared side", () => {
    const card = { name: "Card", scales: [undefined, 7] }
    const left = createTextElement(card, {
      field: "scales",
      format: "pair",
      id: "left-scale",
      kind: "text",
      pairIndex: 0,
      position: { x: 10, y: 20 },
      typography: { fill: "#000", fontFamily: "Test", fontSize: 20 },
    })
    const right = createTextElement(card, {
      field: "scales",
      format: "pair",
      id: "right-scale",
      kind: "text",
      pairIndex: 1,
      position: { x: 10, y: 20 },
      typography: { fill: "#000", fontFamily: "Test", fontSize: 20 },
    })

    expect(left.text).toBe("")
    expect(right.text).toBe("7")
  })

  it("renders a template-declared semantic value with its prefix", () => {
    const element = createTextElement(
      { name: "Referenced document" },
      {
        field: "reference",
        id: "reference",
        kind: "text",
        position: { x: 10, y: 20 },
        prefix: "REF-",
        semanticPath: "document.reference.count",
        typography: { fill: "#000", fontFamily: "Test", fontSize: 20 },
      },
      undefined,
      { semanticValue: 2 },
    )

    expect(element.text).toBe("REF-2")
  })

  it("preserves repeated spaces in rendered text", () => {
    const element = createTextElement(
      { name: "A  B" },
      {
        id: "name",
        kind: "text",
        field: "name",
        position: { x: 10, y: 20 },
        typography: { fill: "#000", fontFamily: "Test", fontSize: 20 },
      },
    )

    expect(element.text).toBe("A  B")
    expect(element.attributes?.["white-space"]).toBe("pre")
    expect(element.attributes?.["xml:space"]).toBe("preserve")
  })

  it("renders rich-text styles and exact horizontal space in one shared vector model", () => {
    const element = createTextElement(
      { name: '<b>ATK</b><space width="1px"/><i>/</i>' },
      {
        id: "name",
        kind: "text",
        field: "name",
        position: { x: 10, y: 20 },
        typography: { fill: "#000", fontFamily: "Test", fontSize: 20 },
      },
      (text) => text.length,
    )

    const svg = serializeSvgElement(element)
    expect(svg).toContain('font-weight="bold"')
    expect(svg).toContain('font-style="italic"')
    expect(svg).toContain('dx="1"')
    expect(svg).toContain('xml:space="preserve"')
  })

  it("renders shift as scoped text-position offsets", () => {
    const element = createTextElement(
      { name: 'Before <shift x="2px" y="-1px">Shifted</shift> after' },
      {
        id: "name",
        kind: "text",
        field: "name",
        position: { x: 10, y: 20 },
        typography: { fill: "#000", fontFamily: "Test", fontSize: 20 },
      },
      (text) => text.length,
    )

    const children = element.children?.[0]?.children ?? []
    expect(children.map((child) => child.text)).toEqual(["Before ", "Shifted", " ", "after"])
    expect(children[1]?.attributes).toMatchObject({ dx: 2, dy: -1 })
    expect(children[2]?.attributes).toMatchObject({ dx: -2, dy: 1 })
    expect(serializeSvgElement(element)).not.toContain("transform=")
  })

  it("renders sup and sub in the active font with baseline alignment", () => {
    const element = createTextElement(
      { name: "1<sup>st</sup> Edition<sub>2</sub>" },
      {
        id: "name",
        kind: "text",
        field: "name",
        position: { x: 10, y: 20 },
        typography: { fill: "#000", fontFamily: "Stone Serif ITC Semi", fontSize: 20 },
      },
      (text) => text.length,
    )

    const children = element.children?.[0]?.children ?? []
    expect(children[1]?.attributes).toMatchObject({
      "baseline-shift": "0.36em",
      dx: -2,
      "font-size": 14,
    })
    expect(children.find((child) => child.text === "2")?.attributes).toMatchObject({
      "baseline-shift": "-0.12em",
      dx: -2,
      "font-size": 14,
    })
    expect(serializeSvgElement(element)).toContain('baseline-shift="0.36em"')
    expect(serializeSvgElement(element)).toContain('baseline-shift="-0.12em"')
    expect(children.find((child) => child.text === "Edition")?.attributes).not.toHaveProperty("dx")
  })

  it("keeps vertical shift out of the next line's line spacing", () => {
    const element = createTextElement(
      { name: '<shift y="1px">Raised</shift>\nNormal' },
      {
        id: "name",
        kind: "text",
        field: "name",
        format: "lines",
        position: { x: 10, y: 20 },
        typography: {
          fill: "#000",
          fontFamily: "Test",
          fontSize: 20,
          lineHeight: 20,
        },
      },
      (text) => text.length,
    )

    expect(element.children?.map((line) => line.attributes?.dy)).toEqual([0, 20])
    expect(element.children?.[0]?.children?.[0]?.attributes).toMatchObject({ dy: 1 })
    expect(element.children?.[1]?.children?.[0]?.attributes).not.toHaveProperty("dy")
  })

  it("centers explicit rich-text alignment inside the declared text box", () => {
    const element = createTextElement(
      { name: '<align value="center">Centered</align>' },
      {
        id: "name",
        kind: "text",
        field: "name",
        position: { x: 10, y: 20 },
        typography: {
          fill: "#000",
          fontFamily: "Test",
          fontSize: 20,
          maxWidth: 100,
        },
      },
      (text) => text.length,
    )

    expect(element.children?.[0]?.attributes).toMatchObject({
      "text-anchor": "middle",
      x: 60,
    })
  })

  it("centers ruby annotations over the measured base text", () => {
    const element = createTextElement(
      { name: '<ruby text="R">AB</ruby>' },
      {
        id: "name",
        kind: "text",
        field: "name",
        position: { x: 10, y: 20 },
        typography: { fill: "#000", fontFamily: "Test", fontSize: 20 },
      },
      (text, typography) => text.length * typography.fontSize,
    )

    const ruby = element.children?.[0]?.children?.[0]
    expect(ruby?.children?.[0]?.attributes).toMatchObject({
      "text-anchor": "middle",
      dx: 20,
    })
    expect(ruby?.children?.[1]?.attributes).toMatchObject({ dx: -30 })
  })

  it("keeps an exact-width icon slot inside a rich semantic label", () => {
    const element = createTextElement(
      { name: '[Document<space width="44px"/>]' },
      {
        id: "documentLabel",
        kind: "text",
        field: "name",
        position: { x: 715, y: 177 },
        typography: {
          fill: "#000",
          fontFamily: "Test",
          fontSize: 20,
          textAnchor: "end",
        },
      },
      (text) => text.length,
    )

    expect(element.children?.[0]?.children?.at(-1)?.attributes).toMatchObject({ dx: 44 })
    expect(element.children?.[0]?.children?.at(-1)?.text).toBe("]")
  })

  it("renders normal editor line breaks even when a layer is not marked as lines", () => {
    const element = createTextElement(
      { name: "First\nSecond" },
      {
        id: "name",
        kind: "text",
        field: "name",
        position: { x: 10, y: 20 },
        typography: { fill: "#000", fontFamily: "Test", fontSize: 20 },
      },
    )

    expect(element.children?.map((child) => child.text)).toEqual(["First", "Second"])
  })

  it("keeps nowrap content together and prevents fitting compression with nocompress", () => {
    const nowrap = createTextElement(
      { name: "<nowrap>This text stays together</nowrap>" },
      {
        id: "name",
        kind: "text",
        field: "name",
        position: { x: 10, y: 20 },
        typography: {
          fill: "#000",
          fontFamily: "Test",
          fontSize: 20,
          maxWidth: 5,
          fit: "scale-x",
          wrap: "word",
        },
      },
      (text) => text.length,
    )
    const nocompress = createTextElement(
      { name: "<nocompress>Oversized</nocompress>" },
      {
        id: "name",
        kind: "text",
        field: "name",
        position: { x: 10, y: 20 },
        typography: { fill: "#000", fontFamily: "Test", fontSize: 20, maxWidth: 5 },
      },
      () => 100,
    )
    const scopedNocompress = createTextElement(
      { name: "<nowrap><nocompress>Fixed </nocompress>Flexible</nowrap>" },
      {
        id: "name",
        kind: "text",
        field: "name",
        position: { x: 10, y: 20 },
        typography: { fill: "#000", fontFamily: "Test", fontSize: 20, maxWidth: 10 },
      },
      (text) => text.length,
    )

    expect(nowrap.children).toHaveLength(1)
    expect(nowrap.attributes?.["font-size"]).toBe(20)
    expect(nowrap.attributes).not.toHaveProperty("textLength")
    expect(nowrap.children?.[0]?.children?.[0]?.attributes).toMatchObject({
      lengthAdjust: "spacingAndGlyphs",
      textLength: 5,
    })
    expect(nocompress.attributes?.["font-size"]).toBe(20)
    expect(nocompress.children?.[0]?.children?.[0]?.attributes).not.toHaveProperty("textLength")
    expect(scopedNocompress.children?.[0]?.children?.[0]?.attributes).not.toHaveProperty(
      "textLength",
    )
    expect(scopedNocompress.children?.[0]?.children?.[1]?.attributes).toMatchObject({
      lengthAdjust: "spacingAndGlyphs",
      textLength: 4,
    })
  })

  it("applies horizontal scale locally, including stretch values above one", () => {
    const element = createTextElement(
      {
        name: '<scale x="0.5">AB</scale><scale x="2">CD</scale>',
      },
      {
        id: "name",
        kind: "text",
        field: "name",
        position: { x: 10, y: 20 },
        typography: { fill: "#000", fontFamily: "Test", fontSize: 20, fit: "scale-x" },
      },
      (text) => text.length,
    )

    expect(element.attributes).toMatchObject({ "font-size": 20 })
    expect(element.attributes).not.toHaveProperty("textLength")
    expect(element.children?.[0]?.children?.[0]?.attributes).toMatchObject({
      lengthAdjust: "spacingAndGlyphs",
      textLength: 1,
    })
    expect(element.children?.[0]?.children?.[1]?.attributes).toMatchObject({
      lengthAdjust: "spacingAndGlyphs",
      textLength: 4,
    })
  })

  it("scales glyphs vertically without changing their horizontal advance or line height", () => {
    const element = createTextElement(
      { name: '<scale y="2">AB</scale>\nCD' },
      {
        id: "name",
        kind: "text",
        field: "name",
        format: "lines",
        position: { x: 10, y: 20 },
        typography: { fill: "#000", fontFamily: "Test", fontSize: 20, lineHeight: 24 },
      },
      (text, typography) => (text.length * typography.fontSize) / 20,
    )

    expect(element.children?.[0]?.attributes?.dy).toBe(0)
    expect(element.children?.[1]?.attributes?.dy).toBe(24)
    expect(element.children?.[0]?.children?.[0]?.attributes).toMatchObject({
      lengthAdjust: "spacingAndGlyphs",
      textLength: 2,
    })
    expect(element.children?.[0]?.children?.[0]?.children?.[0]?.attributes).toMatchObject({
      "font-size": 40,
    })
  })

  it("keeps template justification active alongside scoped compression", () => {
    const element = createTextElement(
      { name: "", effect: '<scale x="0.5">one</scale> two three four' },
      {
        id: "effect",
        kind: "text",
        field: "effect",
        format: "lines",
        position: { x: 10, y: 20 },
        typography: {
          fill: "#000",
          fontFamily: "Test",
          fontSize: 10,
          maxWidth: 12,
          textAlign: "justify",
          wrap: "word",
        },
      },
      (text) => text.length,
    )

    const firstLine = element.children?.[0]
    expect(firstLine?.attributes).toMatchObject({
      lengthAdjust: "spacingAndGlyphs",
      textLength: 12,
    })
    expect(firstLine?.children?.[0]?.attributes).toMatchObject({
      lengthAdjust: "spacingAndGlyphs",
      textLength: 1.5,
    })
  })

  it("lets explicit rich alignment override template justification", () => {
    const element = createTextElement(
      { name: "", effect: '<align value="left">one two three four</align>' },
      {
        id: "effect",
        kind: "text",
        field: "effect",
        format: "lines",
        position: { x: 10, y: 20 },
        typography: {
          fill: "#000",
          fontFamily: "Test",
          fontSize: 10,
          maxWidth: 10,
          textAlign: "justify",
          wrap: "word",
        },
      },
      (text) => text.length,
    )

    expect(element.children?.[0]?.attributes).toMatchObject({
      "text-anchor": "start",
      x: 10,
    })
    expect(element.children?.[0]?.attributes).not.toHaveProperty("textLength")
  })

  it("word-wraps multiline text before applying font-size fitting", () => {
    const element = createTextElement(
      { name: "Test", effect: "one two three" },
      {
        id: "effect",
        kind: "text",
        field: "effect",
        format: "lines",
        position: { x: 10, y: 20 },
        typography: {
          fill: "#000",
          fontFamily: "Test",
          fontSize: 20,
          lineHeight: 24,
          maxWidth: 8,
          minFontSize: 10,
          wrap: "word",
        },
      },
      (text) => text.length,
    )

    expect(element.attributes?.["font-size"]).toBe(20)
    expect(element.children?.map((child) => child.text)).toEqual(["one two ", "three"])
  })

  it("justifies soft-wrapped lines while leaving paragraph endings natural", () => {
    const element = createTextElement(
      { name: "Test", effect: "one two three four" },
      {
        id: "effect",
        kind: "text",
        field: "effect",
        format: "lines",
        position: { x: 10, y: 20 },
        typography: {
          fill: "#000",
          fontFamily: "Test",
          fontSize: 10,
          lineHeight: 12,
          maxWidth: 12,
          textAlign: "justify",
          wrap: "word",
        },
      },
      (text) => text.length,
    )

    expect(element.children?.map((child) => child.text)).toEqual([
      "one",
      " ",
      "two",
      " ",
      "three four",
    ])
    expect(element.children?.slice(0, 4).map((child) => child.attributes?.x)).toEqual([
      10, 13, 18, 21,
    ])
    expect(element.children?.[0]?.attributes?.dy).toBe(0)
    expect(element.children?.[4]?.attributes).toMatchObject({ dy: 12, x: 10 })
    expect(element.children?.[4]?.attributes).not.toHaveProperty("text-anchor")
  })

  it("does not justify authored line breaks", () => {
    const element = createTextElement(
      { name: "Test", effect: "one two\nthree four" },
      {
        id: "effect",
        kind: "text",
        field: "effect",
        format: "lines",
        position: { x: 10, y: 20 },
        typography: {
          fill: "#000",
          fontFamily: "Test",
          fontSize: 10,
          lineHeight: 12,
          maxWidth: 100,
          textAlign: "justify",
          wrap: "word",
        },
      },
      (text) => text.length,
    )

    expect(element.children?.map((child) => child.text)).toEqual(["one two", "three four"])
    expect(element.children?.every((child) => child.attributes?.x === 10)).toBe(true)
  })

  it("shrinks oversized text while preserving normal-sized text", () => {
    const layer = {
      id: "name",
      kind: "text" as const,
      field: "name",
      position: { x: 10, y: 20 },
      typography: {
        fill: "#000",
        fontFamily: "Test",
        fontSize: 20,
        maxWidth: 100,
      },
    }
    const oversized = createTextElement({ name: "Oversized" }, layer, () => 200)
    const fitting = createTextElement({ name: "Fitting" }, layer, () => 80)

    expect(oversized.attributes?.["font-size"]).toBe(10)
    expect(fitting.attributes?.["font-size"]).toBe(20)
  })

  it("can fit oversized text horizontally without reducing its height", () => {
    const element = createTextElement(
      { name: "Wide title" },
      {
        id: "name",
        kind: "text",
        field: "name",
        position: { x: 10, y: 20 },
        typography: {
          fill: "#000",
          fit: "scale-x",
          fontFamily: "Test",
          fontSize: 20,
          maxWidth: 100,
        },
      },
      () => 200,
    )

    expect(element.attributes).toMatchObject({
      "font-size": 20,
      lengthAdjust: "spacingAndGlyphs",
      textLength: 100,
    })
  })

  it("selects the largest type-list preset that fits before using scale-x", () => {
    const layer = {
      field: "types" as const,
      format: "type-list" as const,
      id: "typeLine",
      kind: "text" as const,
      position: { x: 10, y: 20 },
      typography: {
        fill: "#000",
        fit: "scale-x" as const,
        fitProfiles: [
          { fontSize: 31, id: "type-big", label: "Type big" },
          { fontSize: 24, id: "type-small", label: "Type small" },
        ],
        fontFamily: "Test",
        fontSize: 31,
        maxWidth: 40,
      },
    }
    const measure = (text: string, typography: { fontSize: number }) =>
      (text.length * typography.fontSize) / 10

    const big = createTextElement({ name: "Card", types: ["A"] }, layer, measure)
    const small = createTextElement({ name: "Card", types: ["Dragon", "Effect"] }, layer, measure)
    const compressed = createTextElement(
      { name: "Card", types: ["Dragon", "Effect"] },
      { ...layer, typography: { ...layer.typography, maxWidth: 30 } },
      measure,
    )

    expect(big.attributes?.["font-size"]).toBe(31)
    expect(small.attributes?.["font-size"]).toBe(24)
    expect(small.attributes).not.toHaveProperty("textLength")
    expect(compressed.attributes).toMatchObject({
      "font-size": 24,
      lengthAdjust: "spacingAndGlyphs",
      textLength: 30,
    })
  })

  it("scales multiline spacing with the fitted font size", () => {
    const element = createTextElement(
      { name: "Test", effect: ["First", "Second"] },
      {
        id: "effect",
        kind: "text",
        field: "effect",
        format: "lines",
        position: { x: 10, y: 20 },
        typography: {
          fill: "#000",
          fontFamily: "Test",
          fontSize: 20,
          lineHeight: 24,
          maxWidth: 100,
        },
      },
      () => 200,
    )

    expect(element.children?.[1]?.attributes?.["dy"]).toBe(12)
  })

  it("normalizes explicit newlines in strings and array entries", () => {
    const typography = {
      fill: "#000",
      fontFamily: "Test",
      fontSize: 20,
    }
    const layer = {
      id: "effect",
      kind: "text" as const,
      field: "effect",
      format: "lines" as const,
      position: { x: 10, y: 20 },
      typography,
    }

    const stringLines = createTextElement({ name: "Test", effect: "First\r\nSecond" }, layer)
    const arrayLines = createTextElement(
      { name: "Test", effect: ["First\nSecond", "Third"] },
      layer,
    )

    expect(stringLines.children?.map((child) => child.text)).toEqual(["First", "Second"])
    expect(arrayLines.children?.map((child) => child.text)).toEqual(["First", "Second", "Third"])
  })

  it("uses the template minimum font size for an impossible fit", () => {
    const element = createTextElement(
      { name: "A".repeat(10_000) },
      {
        id: "name",
        kind: "text",
        field: "name",
        position: { x: 10, y: 20 },
        typography: {
          fill: "#000",
          fontFamily: "Test",
          fontSize: 20,
          maxWidth: 100,
          minFontSize: 8,
        },
      },
      () => 100_000,
    )

    expect(element.attributes?.["font-size"]).toBe(8)
  })

  it("counts Unicode graphemes rather than UTF-16 code units for letter spacing", () => {
    const context = {
      font: "",
      measureText: () => ({ width: 10 }),
      restore() {},
      save() {},
    } as unknown as CanvasRenderingContext2D
    const typography = {
      fill: "#000",
      fontFamily: "Test",
      fontSize: 20,
      letterSpacing: 2,
    }

    expect(measureTextWidth(context, "🙂", typography)).toBe(10)
    expect(measureTextWidth(context, "e\u0301", typography)).toBe(10)
    expect(measureTextWidth(context, "🙂界", typography)).toBe(12)
  })

  it("chooses the largest declared fit profile that contains the wrapped line count", () => {
    const layer = {
      field: "effect",
      format: "lines" as const,
      id: "effect",
      kind: "text" as const,
      position: { x: 10, y: 20 },
      typography: {
        fill: "#000",
        fitProfiles: [
          { fontSize: 30, id: "large", label: "Large", lineHeight: 30, maxLines: 4 },
          { fontSize: 20, id: "small", label: "Small", lineHeight: 22, maxLines: 6 },
        ],
        fontFamily: "Test",
        fontSize: 30,
        maxWidth: 100,
        verticalAnchor: "top" as const,
        wrap: "word" as const,
      },
    }
    const card = { effect: ["one", "two", "three", "four", "five"], name: "Card" }

    const automatic = createTextElement(card, layer, (text) => text.length)
    const pinnedLarge = createTextElement(card, layer, (text) => text.length, {
      fitProfileId: "large",
    })

    expect(automatic.attributes?.["font-size"]).toBe(20)
    expect(automatic.attributes?.["dominant-baseline"]).toBe("text-before-edge")
    expect(automatic.children?.[1]?.attributes?.["dy"]).toBe(22)
    expect(pinnedLarge.attributes?.["font-size"]).toBe(30)
  })

  it("quantifies automatic horizontal compression before trying the next fit profile", () => {
    const element = createTextElement(
      { effect: "aaaaaa", name: "Card" },
      {
        field: "effect",
        format: "lines",
        id: "effect",
        kind: "text",
        position: { x: 10, y: 20 },
        typography: {
          autoScaleXQuantifier: 0.05,
          fill: "#000",
          fitProfiles: [
            {
              fontSize: 20,
              id: "large",
              label: "Large",
              maxAutoCompressionX: 0.2,
              maxLines: 1,
            },
            { fontSize: 10, id: "small", label: "Small", maxLines: 1 },
          ],
          fontFamily: "Test",
          fontSize: 20,
          maxWidth: 10,
          wrap: "word",
        },
      },
      (text, typography) => (text.length * typography.fontSize) / 10,
    )

    expect(element.attributes?.["font-size"]).toBe(20)
    expect(element.children).toHaveLength(1)
    expect(element.children?.[0]?.attributes).toMatchObject({
      lengthAdjust: "spacingAndGlyphs",
      textLength: 9.6,
    })
  })

  it("fits a leading authored line independently while the remainder selects the profile", () => {
    const layer = {
      field: "effect" as const,
      format: "lines" as const,
      id: "effect",
      kind: "text" as const,
      position: { x: 10, y: 20 },
      typography: {
        autoScaleXQuantifier: 0.01,
        fill: "#000",
        fitBlocks: {
          leading: { mode: "prefer-lines" as const, preferredMaxLines: 1 },
          remainder: { mode: "layer-fit" as const },
          split: "leading-authored-line" as const,
        },
        fitProfiles: [
          {
            fontSize: 20,
            id: "large",
            label: "Large",
            maxAutoCompressionX: 0.2,
            maxLines: 2,
          },
          { fontSize: 10, id: "small", label: "Small", maxLines: 2 },
        ],
        fontFamily: "Test",
        fontSize: 20,
        maxWidth: 20,
        wrap: "word" as const,
      },
    }
    const measure = (text: string, typography: { fontSize: number }) =>
      (text.length * typography.fontSize) / 10

    const plain = createTextElement(
      { effect: "aaaaaaaaaaa\nbbbbbbbbbbbb", name: "Card" },
      layer,
      measure,
    )
    const rich = createTextElement(
      { effect: "<b>aaaaaaaaaaa</b>\nbbbbbbbbbbbb", name: "Card" },
      layer,
      measure,
    )

    expect(plain.attributes?.["font-size"]).toBe(20)
    expect(plain.children?.map((line) => line.attributes?.textLength)).toEqual([19.8, 19.92])
    expect(rich.attributes?.["font-size"]).toBe(20)
    expect(rich.children?.map((line) => line.children?.[0]?.attributes?.textLength)).toEqual([
      19.8, 19.92,
    ])
  })

  it("uses one layer-fit block when a valid authored-line split is absent", () => {
    const element = createTextElement(
      { effect: "aaaaaa", name: "Card" },
      {
        field: "effect",
        format: "lines",
        id: "effect",
        kind: "text",
        position: { x: 10, y: 20 },
        typography: {
          autoScaleXQuantifier: 0.01,
          fill: "#000",
          fitBlocks: {
            leading: { mode: "prefer-lines", preferredMaxLines: 1 },
            remainder: { mode: "layer-fit" },
            split: "leading-authored-line",
          },
          fitProfiles: [
            { fontSize: 20, id: "large", label: "Large", maxLines: 1 },
            { fontSize: 10, id: "small", label: "Small", maxLines: 1 },
          ],
          fontFamily: "Test",
          fontSize: 20,
          maxWidth: 10,
          wrap: "word",
        },
      },
      (text, typography) => (text.length * typography.fontSize) / 10,
    )

    expect(element.attributes?.["font-size"]).toBe(10)
  })
})
