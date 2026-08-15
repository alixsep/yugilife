import { expect, test } from "@playwright/test"

import type { Locator } from "@playwright/test"

async function expectPortableOutlinedSvg(card: Locator) {
  const svg = card.locator("svg")
  await expect(svg).toHaveAttribute("data-yugilife-text-mode", "paths")
  await expect(svg.locator("text, tspan")).toHaveCount(0)
  expect(await svg.locator("path").count()).toBeGreaterThan(0)
}

const realCardFixtures = [
  ["galaxy-serpent", "Galaxy Serpent"],
  ["dinowrestler-pankratops", "Dinowrestler Pankratops"],
  ["vendread-battlelord", "Vendread Battlelord"],
  ["salamangreat-violet-chimera", "Salamangreat Violet Chimera"],
  ["white-aura-monoceros", "White Aura Monoceros"],
  ["tornado-dragon", "Tornado Dragon"],
  ["firewall-dragon", "Firewall Dragon"],
  ["odd-eyes-arc-pendulum-dragon", "Odd-Eyes Arc Pendulum Dragon"],
  ["endymion-the-mighty-master-of-magic", "Endymion, the Mighty Master of Magic"],
  ["ddd-super-doom-king-purple-armageddon", "D/D/D Super Doom King Purple Armageddon"],
  ["clear-wing-fast-dragon", "Clear Wing Fast Dragon"],
  ["odd-eyes-rebellion-dragon", "Odd-Eyes Rebellion Dragon"],
  ["odd-eyes-pendulumgraph-dragon", "Odd-Eyes Pendulumgraph Dragon"],
  ["pot-of-extravagance", "Pot of Extravagance"],
  ["sky-striker-mecha-modules-multirole", "Sky Striker Mecha Modules - Multirole"],
  ["living-fossil", "Living Fossil"],
  ["mystic-mine", "Mystic Mine"],
  ["called-by-the-grave", "Called by the Grave"],
  ["revendread-origin", "Revendread Origin"],
  ["infinite-impermanence", "Infinite Impermanence"],
  ["there-can-be-only-one", "There Can Be Only One"],
  ["red-reboot", "Red Reboot"],
  ["dingirsu-the-orcust-of-the-evening-star", "Dingirsu, the Orcust of the Evening Star"],
  ["gizmek-orochi-the-serpentron-sky-slasher", "Gizmek Orochi, the Serpentron Sky Slasher"],
  ["the-arrival-cyberse-at-ignister", "The Arrival Cyberse @Ignister"],
] as const

for (const [fixtureId, cardName] of realCardFixtures) {
  test(`Series 10 real card: ${cardName}`, async ({ page }) => {
    await page.goto(`/?fixture=${encodeURIComponent(fixtureId)}`)
    const card = page.locator("[data-visual-fixture]")
    await expect(card).toHaveAttribute("data-ready", "true")
    await expect(card).toHaveAttribute("data-card-fixture", fixtureId)
    await expectPortableOutlinedSvg(card)
    await expect(card).toHaveScreenshot(`real-cards/${fixtureId}.webp`)
  })
}

test("Series 10 deterministic render", async ({ page }) => {
  await page.goto("/")
  const card = page.locator("[data-visual-fixture]")
  await expect(card).toHaveAttribute("data-ready", "true")
  await expectPortableOutlinedSvg(card)
  await expect(card).toHaveScreenshot("series-10.webp")
})

test("Series 10 XYZ Pendulum frame masks", async ({ page }) => {
  await page.goto("/?variant=xyz&pendulum=true&artwork=false")
  const card = page.locator("[data-visual-fixture]")
  await expect(card).toHaveAttribute("data-ready", "true")
  await expectPortableOutlinedSvg(card)
  await expect(card.locator("image")).toHaveCount(1)
  await expect(card).toHaveScreenshot("series-10-xyz-pendulum.webp")
})

test("Series 10 Pendulum effect texture geometry", async ({ page }) => {
  for (const variant of ["effect", "fusion"]) {
    for (const size of ["small", "large"]) {
      await page.goto(`/?variant=${variant}&pendulum=true&pendulumSize=${size}&artwork=false`)
      const card = page.locator("[data-visual-fixture]")
      await expect(card).toHaveAttribute("data-ready", "true")
      await expectPortableOutlinedSvg(card)
      await expect(card).toHaveScreenshot(`series-10-${variant}-pendulum-${size}.webp`)
    }
  }
})

test("Series 10 Link and XYZ frame masks", async ({ page }) => {
  for (const variant of ["link", "xyz"]) {
    await page.goto(`/?variant=${variant}`)
    const card = page.locator("[data-visual-fixture]")
    await expect(card).toHaveAttribute("data-ready", "true")
    await expectPortableOutlinedSvg(card)
  }
})

test("Series 10 rich text glyph outlines", async ({ page }) => {
  await page.goto("/?rich=true")
  const card = page.locator("[data-visual-fixture]")
  await expect(card).toHaveAttribute("data-ready", "true")
  await expectPortableOutlinedSvg(card)
  await expect(card).toHaveScreenshot("series-10-rich-text-paths.webp")
})

test("Series 10 native rich text reference", async ({ page }) => {
  await page.goto("/?rich=true&textMode=text")
  const card = page.locator("[data-visual-fixture]")
  await expect(card).toHaveAttribute("data-ready", "true")
  await expect(card.locator("svg")).toHaveAttribute("data-yugilife-text-mode", "text")
  await expect(card).toHaveScreenshot("series-10-rich-text-native.webp")
})
