import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "e2e/pages",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  expect: {
    timeout: 20_000,
  },

  use: {
    baseURL: "http://127.0.0.1:4175/yugilife/",
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
  },

  webServer: {
    command: "pnpm --filter yugilife preview:pages --host 127.0.0.1 --port 4175 --strictPort",
    url: "http://127.0.0.1:4175/yugilife/",
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
  ],
})
