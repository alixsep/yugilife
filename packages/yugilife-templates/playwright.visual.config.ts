import { defineConfig, devices } from "@playwright/test"

const isCI = Boolean(process.env.CI)

export default defineConfig({
  testDir: "tests/visual",
  testMatch: "**/*.visual.spec.ts",
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}-{projectName}-{platform}{ext}",

  forbidOnly: isCI,
  fullyParallel: true,
  retries: isCI ? 2 : 0,
  workers: 4,

  reporter: "list",

  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      maxDiffPixels: 0,
      threshold: 0,
    },
  },

  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: isCI ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: devices["Desktop Chrome"],
    },
  ],

  webServer: {
    command: "vite --config visual/vite.config.ts --host 127.0.0.1 --strictPort",
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:4174",
  },
})
