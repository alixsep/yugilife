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
  ...(isCI ? { workers: 1 } : {}),

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
  ],
})
