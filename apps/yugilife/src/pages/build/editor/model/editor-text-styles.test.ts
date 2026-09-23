import { describe, expect, it } from "vitest"

import { groupEditorTextStyles } from "./editor-text-styles"

import type { ResolvedTextPresentation } from "yugilife-core"

function style(layerId: string, styleId = "default"): ResolvedTextPresentation {
  return {
    layerId,
    position: { x: 0, y: 0 },
    styleId,
    styleLabel: `${layerId} ${styleId}`,
    typography: { fill: "#000000", fontFamily: "Test", fontSize: 12 },
  }
}

describe("grouping the advanced text controls by resolved style", () => {
  it("collapses the three capability lists into one entry per style", () => {
    const name = style("name")
    const groups = groupEditorTextStyles([name], [name], [name])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      compression: true,
      fit: true,
      key: "name:default",
      paint: true,
    })
  })

  it("records only the capabilities a style actually has", () => {
    const groups = groupEditorTextStyles([style("name")], [style("effect")], [style("effect")])
    expect(
      groups.map(({ key, compression, fit, paint }) => ({ key, compression, fit, paint })),
    ).toStrictEqual([
      { key: "effect:default", compression: true, fit: false, paint: true },
      { key: "name:default", compression: false, fit: true, paint: false },
    ])
  })

  it("keeps the same layer's alternative styles apart", () => {
    const groups = groupEditorTextStyles(
      [],
      [],
      [style("name", "plain"), style("name", "full-art")],
    )
    expect(groups.map(({ key }) => key)).toStrictEqual(["name:plain", "name:full-art"])
  })
})
