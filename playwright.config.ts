import { availableParallelism } from "node:os"

import { defineConfig, devices } from "@playwright/test"
import { defineBddConfig } from "playwright-bdd"

const testDir = defineBddConfig({
  features: "e2e/features/**/*.feature",
  steps: "e2e/steps/**/*.ts",
})

const isCI = Boolean(process.env.CI)

export default defineConfig({
  testDir,
  fullyParallel: true,

  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // Card rendering is CPU- and memory-heavy (font outlining, canvas encoding, and WebGL).
  // Playwright's CPU-based default can start too many concurrent browser workers on developer
  // machines, causing otherwise healthy pages to miss the test timeout or lose their session.
  workers: isCI ? 1 : Math.min(4, availableParallelism()),

  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: isCI ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
  },

  webServer: {
    command: "pnpm --filter yugilife preview --host 127.0.0.1 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 120_000,
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
      },
    },
    // Browser-storage behaviour the unit suites cannot reach: jsdom has no IndexedDB, so template
    // caching and texture preparation are only ever exercised against their in-memory fallback.
    // Both engines run it, because how a browser stores a Blob and decodes an image is exactly what
    // is under test.
    {
      name: "app-storage-chromium",
      testDir: "e2e/app",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
    {
      name: "app-storage-firefox",
      testDir: "e2e/app",
      use: {
        ...devices["Desktop Firefox"],
      },
    },
  ],
})
