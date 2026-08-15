import { createCardFromTemplate, exportCardToSvg } from "yugilife-core"

import { DEFAULT_TEMPLATE } from "../../src/index"

import type { CardData } from "yugilife-core"

import "./style.css"

interface RealCardFixture {
  card: Record<string, unknown>
  cardName: string
  id: string
}

const parameters = new URLSearchParams(window.location.search)
const realCardFixtureModules = import.meta.glob<RealCardFixture>(
  "../../tests/visual/fixtures/real-cards/*.json",
  { eager: true, import: "default" },
)
const artworkModules = import.meta.glob<string>("../../tests/visual/fixtures/artworks/*", {
  eager: true,
  import: "default",
  query: "?url",
})
const realCardFixtures = new Map(
  Object.values(realCardFixtureModules).map((fixture) => [fixture.id, fixture]),
)
const artworkUrls = new Map(
  Object.entries(artworkModules).map(([filePath, url]) => [
    filePath.slice(filePath.lastIndexOf("/") + 1).replace(/\.[^.]+$/, ""),
    url,
  ]),
)
const requestedFixtureId = parameters.get("fixture")
const realCardFixture = requestedFixtureId ? realCardFixtures.get(requestedFixtureId) : undefined
if (requestedFixtureId && !realCardFixture) {
  throw new Error(`Unknown real-card visual fixture "${requestedFixtureId}".`)
}

const cardVariant = parameters.get("variant") ?? "effect"
const pendulum = parameters.get("pendulum") === "true"
const richText = parameters.get("rich") === "true"
const includeArtwork = parameters.get("artwork") !== "false"
const syntheticArtwork = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="693" height="680" viewBox="0 0 693 680">
    <defs>
      <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#10182f"/>
        <stop offset="0.52" stop-color="#315b78"/>
        <stop offset="1" stop-color="#d5a84f"/>
      </linearGradient>
    </defs>
    <rect width="693" height="680" fill="url(#background)"/>
    <circle cx="346.5" cy="315" r="205" fill="#f0d58a" fill-opacity=".25"/>
    <path d="M90 585 248 210l98 147 101-214 156 442Z" fill="#08101f" fill-opacity=".88"/>
    <path d="m175 505 94-220 77 115 91-190 82 295Z" fill="#d8b963" fill-opacity=".68"/>
  </svg>
`)}`

const card: CardData = realCardFixture
  ? (() => {
      const artwork = artworkUrls.get(realCardFixture.id)
      if (!artwork) throw new Error(`Artwork is missing for "${realCardFixture.cardName}".`)
      return {
        ...createCardFromTemplate(DEFAULT_TEMPLATE.template),
        ...realCardFixture.card,
        artwork,
      }
    })()
  : {
      ...createCardFromTemplate(DEFAULT_TEMPLATE.template),
      ...(includeArtwork ? { artwork: syntheticArtwork } : {}),
      attack: "2500",
      cardVariant,
      cardCode: "VISUAL-EN001",
      copyright: "YUGILIFE VISUAL FIXTURE",
      defense: "2100",
      description: richText
        ? [
            'A <b>bold</b>, <i>italic</i>, <color value="#7a1515">colored</color> path with <sup>sup</sup> and <shift x="3px" y="-2px">shift</shift>.',
          ]
        : [
            "A deterministic Series 10 visual regression card with a deliberately long description that exercises justified wrapping in the shared vector renderer and SVG export.",
          ],
      edition: "1st Edition",
      level: 8,
      name:
        parameters.has("variant") || pendulum
          ? `${pendulum ? "PENDULUM " : ""}${cardVariant.toLocaleUpperCase()} VISUAL DRAGON`
          : "FIXED VISUAL DRAGON",
      pendulum,
      pendulumSize: parameters.get("pendulumSize") ?? "medium",
      rank: 8,
      serialNumber: "12345678",
      types: ["Dragon", "Effect"],
    }

const host = document.querySelector<HTMLElement>("[data-visual-fixture]")
if (!host) throw new Error("The visual fixture host is missing.")

try {
  host.innerHTML = await exportCardToSvg(card, {
    templateBundle: DEFAULT_TEMPLATE,
    title: card.name,
    ...(parameters.get("textMode") === "text" ? { textMode: "text" } : {}),
  })
  host.dataset.cardFixture = realCardFixture?.id ?? "synthetic"
  host.dataset.ready = "true"
} catch (error) {
  host.dataset.error = error instanceof Error ? error.message : String(error)
  throw error
}
