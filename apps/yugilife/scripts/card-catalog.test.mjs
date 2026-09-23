import assert from "node:assert/strict"
import test from "node:test"

import { transformSource } from "./card-catalog.mjs"

function source(cards) {
  return Buffer.from(JSON.stringify({ data: cards }))
}

function artworkIndex(artworks = []) {
  const cards = [
    ...new Map(
      artworks.map((artwork) => [
        artwork.cardCid,
        {
          konamiCid: artwork.cardCid,
          name: "Fixture card",
          passcode: artwork.passcode,
          provenance: "fixture",
        },
      ]),
    ).values(),
  ]
  return Buffer.from(
    JSON.stringify({
      format: "yugilife/artwork-mapping",
      schemaVersion: 2,
      cards,
      artworks,
    }),
  )
}

function image(id, ...alternates) {
  return [id, ...alternates].map((imageId) => ({ id: imageId, image_url: "ignored" }))
}

const effect = {
  id: 123,
  name: "Example Dragon",
  frameType: "effect",
  desc: "First line\r\nSecond line",
  attribute: "DARK",
  typeline: ["Dragon", "Effect"],
  atk: 2500,
  def: 2000,
  level: 7,
  card_images: image(123, 124),
}

test("transforms only editor-relevant fields deterministically", () => {
  const input = source([
    {
      ...effect,
      card_sets: [{ set_code: "IGNORED" }],
      banlist_info: { ban_tcg: "Forbidden" },
      card_prices: [{ ebay_price: "100" }],
    },
  ])
  const mappings = artworkIndex([
    {
      artworkId: "9001",
      cardCid: "4007",
      classification: "processable",
      mediaReady: true,
      passcode: "00000123",
    },
    {
      artworkId: "9002",
      cardCid: "4007",
      classification: "processable",
      mediaReady: true,
      passcode: "00000123",
    },
  ])
  const first = transformSource(input, mappings)
  const second = transformSource(input, mappings)
  assert.deepEqual(first, second)

  const catalog = JSON.parse(first.catalogText)
  assert.deepEqual(catalog.g.effect, [
    [123, "Example Dragon", 0, [0, 1], "First line\nSecond line", 2500, 2000, 7],
  ])
  assert.deepEqual(catalog.i, { 123: [4007, [9001, 9002]] })
  assert.doesNotMatch(first.catalogText, /banlist|card_sets|price|image_url/)
})

test("packs Link arrows clockwise with Left as the high bit", () => {
  const result = transformSource(
    source([
      {
        ...effect,
        frameType: "link",
        def: undefined,
        level: undefined,
        linkval: 3,
        linkmarkers: ["Left", "Top", "Bottom-Left"],
      },
    ]),
    artworkIndex(),
  )
  const row = JSON.parse(result.catalogText).g.link[0]
  assert.equal(row.at(-1), 128 | 32 | 1)
})

test("records bounded source repairs and known unsupported frames", () => {
  const result = transformSource(
    source([
      {
        ...effect,
        id: 200,
        name: "Pendulum Example",
        frameType: "effect_pendulum",
        scale: 4,
        card_images: image(200),
      },
      {
        id: 201,
        name: "Spell Example",
        frameType: "spell",
        desc: "Spell text",
        race: "",
        humanReadableCardType: "Normal Spell",
        card_images: image(201),
      },
      {
        id: 202,
        name: "Skill Example",
        frameType: "skill",
      },
    ]),
    artworkIndex(),
  )
  const report = JSON.parse(result.reportText)
  assert.deepEqual(
    report.anomalies.map(({ kind }) => kind),
    ["missing-pendulum-split", "inferred-subtype"],
  )
  assert.equal(report.rejected.length, 1)
  assert.deepEqual(JSON.parse(result.catalogText).g.effect_pendulum[0].slice(-2), [4, ""])
})

test("removes the source's apostrophe wrapper from Normal Monster flavor text only", () => {
  const normal = {
    ...effect,
    frameType: "normal",
    typeline: ["Dragon", "Normal"],
  }
  const result = transformSource(
    source([
      {
        ...normal,
        id: 300,
        card_images: image(300),
        name: "Wrapped",
        desc: "''A dragon of \"legend\".''",
      },
      {
        ...normal,
        id: 301,
        card_images: image(301),
        name: "Wrapped Pendulum",
        frameType: "normal_pendulum",
        desc: "[ Pendulum Effect ]\nScale text\n\n[ Monster Effect ]\n''Flavor.''",
        monster_desc: "''Flavor.''",
        pend_desc: "Scale text",
        scale: 4,
      },
      { ...normal, id: 302, card_images: image(302), name: "Speech", desc: "''One.'' ''Two.''" },
      { ...normal, id: 303, card_images: image(303), name: "Quoted", desc: '"Check THIS out!"' },
      { ...effect, id: 304, card_images: image(304), name: "Effect", desc: "''Not flavor text.''" },
    ]),
    artworkIndex(),
  )
  const catalog = JSON.parse(result.catalogText)
  const descriptions = Object.fromEntries(
    [...catalog.g.normal, ...catalog.g.normal_pendulum, ...catalog.g.effect].map((row) => [
      row[1],
      row[4],
    ]),
  )
  assert.deepEqual(descriptions, {
    Effect: "''Not flavor text.''",
    Quoted: '"Check THIS out!"',
    Speech: "''One.'' ''Two.''",
    Wrapped: 'A dragon of "legend".',
    "Wrapped Pendulum": "Flavor.",
  })
  assert.deepEqual(
    JSON.parse(result.reportText)
      .anomalies.filter(({ kind }) => kind === "unwrapped-flavor-text")
      .map(({ name }) => name),
    ["Wrapped", "Wrapped Pendulum"],
  )
})

test("fails closed for new vocabulary and broken Link invariants", () => {
  assert.throws(
    () => transformSource(source([{ ...effect, frameType: "future-frame" }]), artworkIndex()),
    /unknown frameType/,
  )
  assert.throws(
    () =>
      transformSource(
        source([
          {
            ...effect,
            frameType: "link",
            linkval: 2,
            linkmarkers: ["Left"],
          },
        ]),
        artworkIndex(),
      ),
    /does not match/,
  )
})
