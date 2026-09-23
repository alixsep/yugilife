import { devices, test as base } from "@playwright/test"

import type { Page } from "@playwright/test"

interface FixtureWindow {
  renderVisualFixture(search: string): Promise<void>
  verifyPreparedTextures(): Promise<{ checked: number; mismatches: string[] }>
}

/**
 * One loaded harness page per worker.
 *
 * Every case renders the same template through the same fonts and the same prepared textures, so
 * reloading the page for each of them re-paid the whole template setup — the download, the font
 * registration and the color grading — to change the card data. Rendering into one page instead
 * measures the renderer rather than the harness, and it is also how the application behaves: a
 * template is set up once and then draws card after card.
 */
export const test = base.extend<object, { fixturePage: Page }>({
  fixturePage: [
    async ({ browser }, use) => {
      // The project's own device options, which `browser.newContext` does not inherit. Baselines are
      // pixel-exact, so the viewport and scale factor a card renders under must not drift.
      const { defaultBrowserType, ...contextOptions } = devices["Desktop Chrome"]
      void defaultBrowserType
      const context = await browser.newContext(contextOptions)
      const page = await context.newPage()
      await page.goto("/")
      await use(page)
      await context.close()
    },
    { scope: "worker" },
  ],
})

/** Renders one fixture into the shared page and resolves once its SVG is in the document. */
export async function showFixture(page: Page, search: string) {
  await page.evaluate(
    (value) => (window as unknown as FixtureWindow).renderVisualFixture(value),
    search,
  )
  return page.locator("[data-visual-fixture]")
}

export async function checkPreparedTextures(page: Page) {
  return await page.evaluate(() => (window as unknown as FixtureWindow).verifyPreparedTextures())
}
