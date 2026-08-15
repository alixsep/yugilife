import { describe, expect, it } from "vitest"

import {
  graphemeCount,
  hasLeadingAuthoredLineFitSplit,
  parseRichText,
  parseRichTextLength,
  parseRichTextScale,
  plainTextFromRichText,
  richTextLineLengths,
} from "../src"

describe("rich-text syntax", () => {
  it("parses supported tags, nesting, exact spaces, and escaped markup", () => {
    const parsed = parseRichText(
      String.raw`<b><color value="#ff0000">FIRE</color></b> ATK<space width="1px"/>/ \<i\>literal\</i>`,
    )

    expect(parsed.warnings).toEqual([])
    expect(parsed.document.children).toHaveLength(4)
    expect(parsed.document.children[0]).toMatchObject({
      kind: "element",
      tag: "b",
      children: [{ kind: "element", tag: "color", attributes: { value: "#ff0000" } }],
    })
    expect(plainTextFromRichText(parsed.document)).toBe("FIRE ATK / <i>literal</i>")
  })

  it("accepts signed tracking and em/px lengths", () => {
    expect(parseRichTextLength("29.5px")).toStrictEqual({ unit: "px", value: 29.5 })
    expect(parseRichTextLength("0.5em")).toStrictEqual({ unit: "em", value: 0.5 })
    expect(parseRichTextScale("0.75")).toBe(0.75)
    expect(parseRichTextScale("1.25")).toBe(1.25)
    expect(parseRichText('<tracking value="-0.5px">Tight</tracking>').warnings).toEqual([])
    expect(parseRichText('<scale x="2">Stretched</scale>').warnings).toEqual([])
    expect(parseRichText('<scale y="0.8">Shorter</scale>').warnings).toEqual([])
    expect(parseRichText('<scale x="0.8" y="1.2">Both</scale>').warnings).toEqual([])
    expect(parseRichText("<scale>Missing axes</scale>").warnings[0]?.code).toBe("invalid-value")
    expect(parseRichText('<scale x="0">Invisible</scale>').warnings[0]?.code).toBe("invalid-value")
    expect(parseRichText('<shift x="1px">Right</shift>').warnings).toEqual([])
    expect(parseRichText('<shift y="-1px">Up</shift>').warnings).toEqual([])
    expect(parseRichText("<shift>Missing axes</shift>").warnings[0]?.code).toBe("invalid-value")
    expect(parseRichText('<space width="-1px"/>').warnings[0]?.code).toBe("invalid-value")
  })

  it("accepts the complete documented formatting vocabulary", () => {
    const parsed = parseRichText(
      '<i><size value="18px"><tracking value="-0.5px"><shift x="2px"><ruby text="カオス・ナンバーズ"><color value="#ffffff">CX</color></ruby></shift></tracking></size></i> <sup>st</sup><sub>2</sub> <nowrap align="justify">one two</nowrap> <nocompress><scale x="1.25"><align value="center">three</align></scale></nocompress>',
    )

    expect(parsed.warnings).toEqual([])
    expect(plainTextFromRichText(parsed.document)).toBe("CX st2 one two three")
  })

  it("counts visible rich-text graphemes per rendered line", () => {
    expect(graphemeCount("👨‍👩‍👧‍👦")).toBe(1)
    expect(
      richTextLineLengths('<color value="#ff0000">AB</color><sup>st</sup>\nC<space width="1px"/>D'),
    ).toEqual([4, 3])
  })

  it("detects a visible leading authored line independently of rich-text markup", () => {
    expect(hasLeadingAuthoredLineFitSplit("Materials\nEffect text")).toBe(true)
    expect(
      hasLeadingAuthoredLineFitSplit(
        parseRichText("<b>Materials</b>\r\n<i>Effect text</i>").document,
      ),
    ).toBe(true)
    expect(hasLeadingAuthoredLineFitSplit("Materials without an authored newline")).toBe(false)
    expect(hasLeadingAuthoredLineFitSplit("   \nEffect text")).toBe(false)
    expect(hasLeadingAuthoredLineFitSplit("Materials\n \n")).toBe(false)
  })

  it("keeps unknown tags literal while leaving unclosed known formatting open", () => {
    const parsed = parseRichText("<big>Literal</big><b>Unclosed")

    expect(plainTextFromRichText(parsed.document)).toBe("<big>Literal</big>Unclosed")
    expect(parsed.document.children.at(-1)).toMatchObject({
      children: [{ kind: "text", text: "Unclosed" }],
      kind: "element",
      tag: "b",
    })
    expect(parsed.warnings.map(({ code }) => code)).toEqual([
      "unknown-tag",
      "unknown-tag",
      "unclosed-tag",
    ])
  })

  it("reports mismatched closing tags without changing the open formatting scope", () => {
    const parsed = parseRichText("<b>Bold</i> still bold</b>")

    expect(parsed.warnings.map(({ code }) => code)).toEqual(["mismatched-closing-tag"])
    expect(parsed.document.children[0]).toMatchObject({ tag: "b" })
  })
})
