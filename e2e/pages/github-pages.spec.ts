import { expect, test } from "@playwright/test"

const deploymentPath = "/yugilife/"

test("the GitHub Pages artifact loads and keeps every app route on the deploy path", async ({
  page,
}) => {
  const failedLocalResponses: string[] = []
  page.on("response", (response) => {
    const url = new URL(response.url())
    if (url.origin === "http://127.0.0.1:4175" && response.status() >= 400) {
      failedLocalResponses.push(`${response.status()} ${url.pathname}`)
    }
  })

  const response = await page.goto(deploymentPath)
  expect(response?.ok()).toBe(true)
  await expect(
    page.getByRole("heading", { name: "Create high quality Yu-Gi-Oh! cards!" }),
  ).toBeVisible()

  const localResources = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => new URL(entry.name))
      .filter((url) => url.origin === window.location.origin)
      .map((url) => url.pathname),
  )
  expect(localResources.length).toBeGreaterThan(0)
  expect(localResources.every((path) => path.startsWith(deploymentPath))).toBe(true)

  await page.goto(`${deploymentPath}#/inventory`)
  await expect(page.getByRole("heading", { exact: true, name: "Inventory" })).toBeVisible()
  await expect(page).toHaveURL(/\/yugilife\/#\/inventory$/)

  await page.getByRole("link", { exact: true, name: "Build" }).click()
  await expect(page.getByRole("textbox", { exact: true, name: "Name" })).toBeVisible()
  await expect(page).toHaveURL(/\/yugilife\/#\/build\/[^/]+$/)

  await page.reload()
  await expect(page.getByRole("textbox", { exact: true, name: "Name" })).toBeVisible()
  expect(failedLocalResponses).toEqual([])
})
