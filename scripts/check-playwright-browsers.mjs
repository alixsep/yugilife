import { access } from "node:fs/promises"

import { chromium, firefox } from "@playwright/test"

const browserTypes = { chromium, firefox }
const requested = process.argv.slice(2)
if (requested.length === 0 || requested.some((name) => !(name in browserTypes))) {
  throw new Error("Expected one or more supported browser names: chromium, firefox.")
}

const missing = []
for (const name of requested) {
  try {
    await access(browserTypes[name].executablePath())
  } catch {
    missing.push(name)
  }
}

if (missing.length > 0) {
  throw new Error(
    `Missing Playwright browser binaries (${missing.join(", ")}); run pnpm setup:browsers from the repository root before testing.`,
  )
}

console.log(`Verified Playwright browser binaries: ${requested.join(", ")}`)
