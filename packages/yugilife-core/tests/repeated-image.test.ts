import { afterEach, describe, expect, it, vi } from "vitest"

import { renderCard } from "../src"

import { NAME_FIELD, testTemplate, testTemplateBundle } from "./fixtures"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("repeated-image rendering", () => {
  it("draws one image per field value using the declared offset", async () => {
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D)

    await renderCard(
      { level: 13, name: "Thirteen stars" },
      {
        assets: {
          "star.level": { height: 49, width: 49 } as unknown as HTMLCanvasElement,
        },
        templateBundle: testTemplateBundle(
          testTemplate({
            cardFields: [
              NAME_FIELD,
              { kind: "number", label: "Level", max: 13, min: 1, name: "level", required: true },
            ],
            layers: [
              {
                assetId: "star.level",
                field: "level",
                id: "levelStars",
                kind: "repeated-image",
                offset: { x: -53.6, y: 0 },
                region: { height: 49, width: 49, x: 680, y: 145 },
              },
            ],
          }),
        ),
      },
    )

    expect(drawImage).toHaveBeenCalledTimes(13)
    expect(drawImage.mock.calls[0]?.slice(1)).toEqual([680, 145, 49, 49])
    expect(drawImage.mock.calls[12]?.[1]).toBeCloseTo(36.8)
  })
})
