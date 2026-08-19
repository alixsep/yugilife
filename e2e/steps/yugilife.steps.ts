import { expect } from "@playwright/test"
import { createBdd, test } from "playwright-bdd"

import type { Page } from "@playwright/test"

const { Given, Then, When } = createBdd(test)
const landingReadyTimeout = 45_000

Given("I open the Yugilife app", async ({ page }) => {
  await page.goto("/")
})

Then("I see the card creation heading", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "Create high quality Yu-Gi-Oh! cards!" }),
  ).toBeVisible()
})

When("I navigate to the Yugilife home", async ({ page }) => {
  await page.getByRole("link", { name: "Yugilife home" }).click()
  await expect(page).toHaveURL(/\/$/)
})

Then("the landing scene is rendered", async ({ page }) => {
  const landingPage = page.locator("main.landing-page")
  await expect(landingPage).toHaveAttribute("data-landing-ready", "true", {
    timeout: landingReadyTimeout,
  })
  await expect(landingPage.locator(".landing-canvas-slot canvas")).toBeVisible({
    timeout: landingReadyTimeout,
  })
})

Given("I open the card builder", async ({ page }) => {
  await page.goto("/build")
  await expect(cardName(page)).toBeVisible()
})

Given("I open the Salamangreat card builder", async ({ page }) => {
  await page.goto("/inventory")
  await expect(page.getByRole("heading", { exact: true, name: "Inventory" })).toBeVisible()
  await page.getByRole("button", { name: /^Salamangreat Violet Chimera/ }).click()
  await expect(
    page.getByRole("heading", { exact: true, name: "Salamangreat Violet Chimera" }),
  ).toBeVisible()
  await page.getByRole("link", { exact: true, name: "Edit card" }).click()
  await expect(page.locator('[data-template="card/series-10"] svg').first()).toBeVisible()
})

Given("I open the inventory", async ({ page }) => {
  await page.goto("/inventory")
  await expect(page.getByRole("heading", { exact: true, name: "Inventory" })).toBeVisible()
})

When("I create an inventory card", async ({ page }) => {
  await page.getByRole("link", { exact: true, name: "Build" }).click()
  await expect(cardName(page)).toBeVisible()
  const currentUrl = page.url()
  await page.getByRole("button", { exact: true, name: "New card" }).click()
  await page.getByRole("button", { exact: true, name: "Create new card" }).click()
  await expect(page).not.toHaveURL(currentUrl)
  await expect(cardName(page)).toHaveValue("Sample Card Title")
})

When("I return to the inventory", async ({ page }) => {
  await page.getByRole("link", { exact: true, name: "Inventory" }).click()
  await expect(page.getByRole("heading", { exact: true, name: "Inventory" })).toBeVisible()
})

Then("the inventory contains {string}", async ({ page }, name: string) => {
  await expect(page.getByRole("button", { name })).toBeVisible()
})

Then("the inventory card {string} has a preview", async ({ page }, name: string) => {
  await expect(page.getByRole("button", { name }).locator("img")).toBeVisible()
})

When("I duplicate the selected inventory card", async ({ page }) => {
  await page.getByRole("button", { name: "Duplicate" }).click()
})

When("I change the card name to {string}", async ({ page }, value: string) => {
  await cardName(page).fill(value)
})

When("I save the card", async ({ page }) => {
  const save = page.getByRole("button", { exact: true, name: "Save" })
  await expect(save).toBeEnabled()
  await save.click()
  await expect(page.getByRole("button", { exact: true, name: "Saved" })).toBeVisible()
})

When("I refresh the card builder", async ({ page }) => {
  await page.reload()
})

When("I reopen the card builder entry", async ({ page }) => {
  await page.goto("/build")
  await expect(cardName(page)).toBeVisible()
})

When("I create a new card from the builder", async ({ page }) => {
  const currentUrl = page.url()
  await page.getByRole("button", { exact: true, name: "New card" }).click()
  await page.getByRole("button", { exact: true, name: "Create new card" }).click()
  await expect(page).not.toHaveURL(currentUrl)
  await expect(cardName(page)).toBeVisible()
})

When("I select WebP at 2× export size", async ({ page }) => {
  await page.getByRole("tab", { exact: true, name: "Export" }).click()
  await page.getByRole("tab", { exact: true, name: "WebP" }).click()
  await page.getByRole("combobox", { name: "Preset" }).click()
  await page.getByRole("option", { exact: true, name: "2×" }).click()
})

Then("the card name is {string}", async ({ page }, value: string) => {
  await expect(cardName(page)).toHaveValue(value)
})

Then("the Salamangreat preview uses outlined glyphs", async ({ page }) => {
  const card = page.locator('[data-template="card/series-10"]')
  await expect(card.locator("svg text, svg tspan")).toHaveCount(0)
  expect(await card.locator("svg path").count()).toBeGreaterThan(0)
})

Then("the export dimensions are {string}", async ({ page }, value: string) => {
  await expect(page.getByText(value, { exact: true })).toBeVisible()
})

Then("the lossy image quality control is visible", async ({ page }) => {
  await expect(page.getByText("Quality", { exact: true })).toBeVisible()
  await expect(page.getByRole("slider", { name: "Quality" })).toHaveAttribute("aria-valuenow", "92")
})

Then("the inventory has {int} cards", async ({ page }, count: number) => {
  await expect(page.getByText(`${count} cards`, { exact: true })).toBeVisible()
})

function cardName(page: Page) {
  return page.getByRole("textbox", { exact: true, name: "Name" })
}
