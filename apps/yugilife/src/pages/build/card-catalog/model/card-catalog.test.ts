import { readFileSync } from "node:fs"
import { brotliDecompressSync } from "node:zlib"

import { describe, expect, it } from "vitest"

import { cardCatalogEntryPatch, createCardCatalogSearch, parseCardCatalog } from "./card-catalog"

const frames = [
  "normal",
  "effect",
  "ritual",
  "fusion",
  "synchro",
  "xyz",
  "link",
  "token",
  "spell",
  "trap",
  "normal_pendulum",
  "effect_pendulum",
  "ritual_pendulum",
  "fusion_pendulum",
  "synchro_pendulum",
  "xyz_pendulum",
] as const

function catalog(overrides: Partial<Record<(typeof frames)[number], unknown[]>> = {}) {
  const hasArtworkCard = Object.values(overrides)
    .flat()
    .some((row) => Array.isArray(row) && row[0] === 89631139)
  return JSON.stringify({
    v: 2,
    a: ["DARK", "LIGHT", "EARTH", "WATER", "FIRE", "WIND", "DIVINE"],
    s: ["Normal", "Continuous", "Counter", "Equip", "Field", "Quick-Play", "Ritual"],
    t: ["Dragon", "Effect", "Link"],
    g: Object.fromEntries(frames.map((frame) => [frame, overrides[frame] ?? []])),
    i: hasArtworkCard ? { 89631139: [4007, [3801, 4007]] } : {},
  })
}

describe("card catalog", () => {
  it("accepts the committed generated artifact", () => {
    const publicDirectory = "public/card-catalog"
    const manifest = JSON.parse(readFileSync(`${publicDirectory}/manifest.json`, "utf8")) as {
      catalog: { file: string; recordCount: number }
    }
    const source = brotliDecompressSync(
      readFileSync(`${publicDirectory}/${manifest.catalog.file}`),
    ).toString("utf8")

    expect(parseCardCatalog(source, manifest.catalog.recordCount).entries).toHaveLength(
      manifest.catalog.recordCount,
    )
  })

  it("validates, decodes, and searches names and padded passcodes", () => {
    const parsed = parseCardCatalog(
      catalog({
        effect: [[423705, "Alpha Dragon", 0, [0, 1], "Effect text", 2000, -1, 4]],
        link: [[89631139, "Blue-Eyes Link", 1, [0, 2], "Link text", 3000, 129]],
      }),
      2,
    )
    const search = createCardCatalogSearch(parsed)

    expect(search.search("alpha").map(({ name }) => name)).toEqual(["Alpha Dragon"])
    expect(search.search("00423705").map(({ name }) => name)).toEqual(["Alpha Dragon"])
    expect(search.search("423705").map(({ name }) => name)).toEqual(["Alpha Dragon"])
    expect(search.search("8963").map(({ name }) => name)).toEqual(["Blue-Eyes Link"])
    expect(search.search("blue eyes li").map(({ name }) => name)).toEqual(["Blue-Eyes Link"])
    expect(search.search("blue-eyes li").map(({ name }) => name)).toEqual(["Blue-Eyes Link"])
    expect(search.search("---")).toEqual([])
    expect(parsed.entries[1]).toMatchObject({
      artworkIds: [3801, 4007],
      konamiCid: 4007,
      passcode: "89631139",
      sourceId: 89631139,
    })
    expect(search.search("4007").map(({ name }) => name)).toEqual(["Blue-Eyes Link"])
  })

  it("creates one editor patch that clears stale print identity without presentation values", () => {
    const parsed = parseCardCatalog(
      catalog({
        effect_pendulum: [
          [423705, "Pendulum Dragon", 0, [0, 1], "Monster text", -1, 0, 7, 4, "Scale text"],
        ],
      }),
      1,
    )
    const patch = cardCatalogEntryPatch(parsed.entries[0]!)

    expect(patch).toMatchObject({
      attack: "?",
      artwork: "",
      artworkOverlay: "",
      cardCode: "",
      cardVariant: "effect",
      defense: "0",
      description: "Monster text",
      edition: "",
      level: 7,
      name: "Pendulum Dragon",
      pendulum: true,
      pendulumEffect: "Scale text",
      scales: [4, 4],
      serialNumber: "00423705",
      types: ["Dragon", "Effect"],
    })
    expect(patch).not.toHaveProperty("pendulumSize")
  })

  it("places a verified downloaded artwork in the same atomic editor patch", () => {
    const parsed = parseCardCatalog(
      catalog({ effect: [[89631139, "Artwork Card", 0, [0, 1], "Text", 1000, 1000, 4]] }),
      1,
    )
    const artwork = new Blob(["avif"], { type: "image/avif" })

    expect(cardCatalogEntryPatch(parsed.entries[0]!, artwork).artwork).toBe(artwork)
  })

  it("derives Link rating and template arrow names from the mask", () => {
    const parsed = parseCardCatalog(
      catalog({ link: [[89631139, "Link", 0, [0, 2], "Text", 2500, 129]] }),
      1,
    )
    expect(cardCatalogEntryPatch(parsed.entries[0]!)).toMatchObject({
      link: 2,
      linkArrows: ["left-center", "bottom-left"],
    })
  })

  it("rejects malformed dictionaries, duplicate identities, and bad rows", () => {
    const wrongAttributes = JSON.parse(catalog()) as { a: string[] }
    wrongAttributes.a[0] = "dark"
    expect(() => parseCardCatalog(JSON.stringify(wrongAttributes))).toThrow(/does not match schema/)

    expect(() =>
      parseCardCatalog(
        catalog({
          effect: [
            [1, "Duplicate", 0, [0], "Text", 0, 0, 1],
            [1, "Duplicate 2", 0, [0], "Text", 0, 0, 1],
          ],
        }),
      ),
    ).toThrow(/duplicate source ID/)

    const duplicateArtwork = JSON.parse(
      catalog({
        effect: [
          [1, "First", 0, [0], "Text", 0, 0, 1],
          [2, "Second", 0, [0], "Text", 0, 0, 1],
        ],
      }),
    ) as { i: Record<string, [number, number[]]> }
    duplicateArtwork.i = { 1: [10, [9001]], 2: [20, [9001]] }
    expect(() => parseCardCatalog(JSON.stringify(duplicateArtwork))).toThrow(
      /assigned to more than one card/,
    )
  })
})
