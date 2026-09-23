import { createCardFromTemplate, exportCardToSvg } from "yugilife-core"
import { prepareTemplateTextures } from "yugilife-core/color-grading"

import { DEFAULT_TEMPLATE } from "../../src/index"

import { verifyPreparedTextures } from "./prepared-texture-check"

import type { PreparedTextureCheck } from "./prepared-texture-check"
import type { CardData, PreparedTextures } from "yugilife-core"

import "./style.css"

interface RealCardFixture {
  card: Record<string, unknown>
  cardName: string
  id: string
}

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
const syntheticArtworkMask = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="813" height="1185" viewBox="0 0 813 1185">
    <rect width="813" height="1185" fill="#000"/>
    <path d="M250 0h313v1185H250z" fill="#fff"/>
  </svg>
`)}`

function fixtureCard(parameters: URLSearchParams) {
  const requestedFixtureId = parameters.get("fixture")
  const realCardFixture = requestedFixtureId ? realCardFixtures.get(requestedFixtureId) : undefined
  if (requestedFixtureId && !realCardFixture) {
    throw new Error(`Unknown real-card visual fixture "${requestedFixtureId}".`)
  }
  if (realCardFixture) {
    const artwork = artworkUrls.get(realCardFixture.id)
    if (!artwork) throw new Error(`Artwork is missing for "${realCardFixture.cardName}".`)
    return {
      id: realCardFixture.id,
      card: {
        ...createCardFromTemplate(DEFAULT_TEMPLATE.template),
        ...realCardFixture.card,
        artwork,
      } as CardData,
    }
  }

  const cardVariant = parameters.get("variant") ?? "effect"
  const pendulum = parameters.get("pendulum") === "true"
  const richText = parameters.get("rich") === "true"
  const card: CardData = {
    ...createCardFromTemplate(DEFAULT_TEMPLATE.template),
    ...(parameters.get("artwork") !== "false" ? { artwork: syntheticArtwork } : {}),
    ...(parameters.get("fullArt") === "true" ? { artworkOverlay: syntheticArtworkMask } : {}),
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
  return { card, id: "synthetic" }
}

/**
 * The template's textures, graded once for the whole page.
 *
 * Every fixture on this page draws the same frame and effect-box textures, so grading them per
 * fixture would measure the same work over and over instead of the rendering under test. Preparing
 * them is also what the application does before its first card, so the baselines describe the pixels
 * users actually see.
 */
let preparing: Promise<PreparedTextures> | undefined
function preparedTextures() {
  preparing ??= prepareTemplateTextures(DEFAULT_TEMPLATE).then(({ textures }) => textures)
  return preparing
}

function fixtureHost() {
  const host = document.querySelector<HTMLElement>("[data-visual-fixture]")
  if (!host) throw new Error("The visual fixture host is missing.")
  return host
}

async function drawFixture(search: string) {
  const host = fixtureHost()
  const parameters = new URLSearchParams(search)
  delete host.dataset.ready
  delete host.dataset.error
  try {
    const { card, id } = fixtureCard(parameters)
    // `prepared=false` keeps the live grading path reachable: it is what an application renders
    // with before its textures have been prepared, and it must keep working on its own.
    const textures = parameters.get("prepared") === "false" ? undefined : await preparedTextures()
    host.innerHTML = await exportCardToSvg(card, {
      templateBundle: DEFAULT_TEMPLATE,
      title: card.name,
      ...(textures ? { preparedTextures: textures } : {}),
      ...(parameters.get("fullArt") === "true"
        ? {
            presentationOverrides: {
              artworkTransforms: {
                artwork: { mode: "full-art", scale: 1.5, x: 0, y: 0 },
              },
            },
          }
        : {}),
      ...(parameters.get("textMode") === "text" ? { textMode: "text" } : {}),
    })
    host.dataset.cardFixture = id
    host.dataset.ready = "true"
  } catch (error) {
    host.dataset.error = error instanceof Error ? error.message : String(error)
    throw error
  }
}

/**
 * Renders one fixture into the shared host, one at a time.
 *
 * Exposed so the suite can exercise many fixtures against one loaded page rather than reloading the
 * harness, its fonts and its textures for each of them. Renders are queued rather than started
 * concurrently: they all write the same host element, so a slower one finishing last would leave
 * the page showing a card nobody asked for — including the fixture this page first loaded with.
 */
let queued: Promise<void> = Promise.resolve()
function renderFixture(search: string) {
  const next = queued.then(
    () => drawFixture(search),
    () => drawFixture(search),
  )
  queued = next.catch(() => undefined)
  return next
}

declare global {
  interface Window {
    renderVisualFixture(search: string): Promise<void>
    verifyPreparedTextures(): Promise<PreparedTextureCheck>
  }
}

window.renderVisualFixture = renderFixture
window.verifyPreparedTextures = async () => await verifyPreparedTextures(await preparedTextures())

await renderFixture(window.location.search)
