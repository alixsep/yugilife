import { access } from "node:fs/promises"

import {
  BrowserHost,
  getChromiumExecutablePath,
  getPlaywrightVersion,
  readCoreVersion,
} from "../runtime/browser-host.js"
import { CliError } from "../runtime/errors.js"
import { cliVersion } from "../version.js"

export async function runDoctor(signal?: AbortSignal) {
  const executablePath = getChromiumExecutablePath()
  try {
    await access(executablePath)
  } catch (error) {
    throw new CliError(
      "BROWSER_UNAVAILABLE",
      `Required YugiLife Chromium build is not installed at "${executablePath}".\nRun:\n  pnpm setup:browsers`,
      { cause: error },
    )
  }

  const host = new BrowserHost()
  try {
    await host.start(signal)
    const smoke = await host.smoke(signal)
    return [
      `YugiLife CLI ${cliVersion}`,
      `YugiLife Core ${await readCoreVersion()}`,
      "",
      `Node.js       ${process.version}`,
      `Platform      ${process.platform} ${process.arch}`,
      `Chromium      installed (${executablePath})`,
      `Playwright    ${getPlaywrightVersion()}`,
      `Renderer      ready (${smoke.dimensions.width}x${smoke.dimensions.height} smoke card)`,
      "",
    ].join("\n")
  } finally {
    await host.close()
  }
}
