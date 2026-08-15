import { access, readFile } from "node:fs/promises"
import { createServer } from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { chromium } from "playwright-core"

import { CliError } from "./errors.js"

import type {
  BrowserApi,
  BrowserRenderSuccess,
  BrowserSmokeResult,
  SerializedRenderRequest,
} from "./protocol.js"
import type { Socket } from "node:net"
import type { Browser, BrowserContext, Page } from "playwright-core"

interface HarnessServer {
  readonly url: string
  close(): Promise<void>
}

interface BrowserHostOptions {
  readonly browserExecutablePath?: string
  readonly bundlePath?: string
  readonly coreDistributionPath?: string
}

interface BrowserGlobal {
  readonly __yugilifeCli?: BrowserApi
}

const playwrightVersion = "1.62.0"
const rendererReadyTimeoutMs = 15_000

function contentType(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8"
    case ".js":
      return "text/javascript; charset=utf-8"
    case ".json":
      return "application/json; charset=utf-8"
    case ".jpeg":
    case ".jpg":
      return "image/jpeg"
    case ".otf":
      return "font/otf"
    case ".png":
      return "image/png"
    case ".svg":
      return "image/svg+xml"
    case ".ttf":
      return "font/ttf"
    case ".woff":
      return "font/woff"
    case ".woff2":
      return "font/woff2"
    case ".webp":
      return "image/webp"
    default:
      return "application/octet-stream"
  }
}

function safeChildPath(root: string, relativePath: string) {
  const resolved = path.resolve(root, relativePath)
  const relative = path.relative(root, resolved)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return undefined
  }
  return resolved
}

function harnessHtml() {
  const importMap = JSON.stringify({ imports: { "yugilife-core": "/core/index.js" } })
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>YugiLife CLI renderer</title>
    <script type="importmap">${importMap}</script>
  </head>
  <body>
    <script type="module" src="/renderer.js"></script>
  </body>
</html>
`
}

async function createHarnessServer(
  bundlePath: string,
  coreDistributionPath: string,
): Promise<HarnessServer> {
  try {
    await Promise.all([access(bundlePath), access(path.join(coreDistributionPath, "index.js"))])
  } catch (error) {
    throw new CliError(
      "HARNESS_UNAVAILABLE",
      "The CLI browser harness is not built. Run the yugilife-cli package build first.",
      { cause: error },
    )
  }

  const server = createServer((request, response) => {
    void (async () => {
      const requestPath = new URL(request.url ?? "/", "http://127.0.0.1").pathname
      if (requestPath === "/") {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "text/html; charset=utf-8",
        })
        response.end(harnessHtml())
        return
      }

      let filePath: string | undefined
      if (requestPath === "/renderer.js") {
        filePath = bundlePath
      } else if (requestPath.startsWith("/core/")) {
        let relativePath: string
        try {
          relativePath = decodeURIComponent(requestPath.slice("/core/".length))
        } catch {
          response.writeHead(400)
          response.end("Malformed URL")
          return
        }
        filePath = safeChildPath(coreDistributionPath, relativePath)
      }

      if (!filePath) {
        response.writeHead(404)
        response.end("Not found")
        return
      }

      try {
        const contents = await readFile(filePath)
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": contentType(filePath),
        })
        response.end(contents)
      } catch {
        response.writeHead(404)
        response.end("Not found")
      }
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500)
      response.end("Harness server failure")
    })
  })
  const sockets = new Set<Socket>()
  server.on("connection", (socket) => sockets.add(socket))
  server.on("close", () => sockets.clear())

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  }).catch((error) => {
    sockets.forEach((socket) => socket.destroy())
    throw new CliError("HARNESS_UNAVAILABLE", "Could not start the local browser harness.", {
      cause: error,
    })
  })

  const address = server.address()
  if (!address || typeof address === "string") {
    sockets.forEach((socket) => socket.destroy())
    server.close()
    throw new CliError("HARNESS_UNAVAILABLE", "The local browser harness did not receive a port.")
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      sockets.forEach((socket) => socket.destroy())
      if (!server.listening) return
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}

function defaultBundlePath() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../browser/renderer.js")
}

function resolveCoreDistributionPath() {
  try {
    const packageJsonPath = import.meta.resolve("yugilife-core/package.json")
    return path.join(path.dirname(fileURLToPath(packageJsonPath)), "dist")
  } catch (error) {
    throw new CliError(
      "CORE_UNAVAILABLE",
      "The yugilife-core package is not available to the CLI.",
      { cause: error },
    )
  }
}

export function getPlaywrightVersion() {
  return playwrightVersion
}

export function getChromiumExecutablePath() {
  return chromium.executablePath()
}

export function getCoreDistributionPath() {
  return resolveCoreDistributionPath()
}

async function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  onAbort: () => void,
): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    onAbort()
    throw new CliError("CLI_INTERRUPTED", "The render was interrupted.")
  }
  return await new Promise<T>((resolve, reject) => {
    const abort = () => {
      onAbort()
      reject(new CliError("CLI_INTERRUPTED", "The render was interrupted."))
    }
    signal.addEventListener("abort", abort, { once: true })
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

export class BrowserHost {
  #browser: Browser | undefined
  #context: BrowserContext | undefined
  #page: Page | undefined
  #server: HarnessServer | undefined
  #closing = false
  #pageError: Error | undefined
  readonly #options: BrowserHostOptions

  constructor(options: BrowserHostOptions = {}) {
    this.#options = options
  }

  async start(signal?: AbortSignal) {
    if (this.#page) return
    if (this.#closing) throw new CliError("HARNESS_UNAVAILABLE", "The browser host is closing.")
    if (signal?.aborted) throw new CliError("CLI_INTERRUPTED", "The render was interrupted.")

    const executablePath = this.#options.browserExecutablePath ?? getChromiumExecutablePath()
    try {
      await access(executablePath)
    } catch (error) {
      throw new CliError(
        "BROWSER_UNAVAILABLE",
        `Required YugiLife Chromium build is not installed at "${executablePath}".\nRun:\n  pnpm setup:browsers`,
        { cause: error },
      )
    }

    try {
      this.#server = await createHarnessServer(
        this.#options.bundlePath ?? defaultBundlePath(),
        this.#options.coreDistributionPath ?? getCoreDistributionPath(),
      )
      if (signal?.aborted) {
        throw new CliError("CLI_INTERRUPTED", "The render was interrupted.")
      }
      try {
        this.#browser = await chromium.launch({ executablePath, headless: true })
      } catch (error) {
        throw new CliError(
          "BROWSER_UNAVAILABLE",
          `Could not launch the required YugiLife Chromium build at "${executablePath}".`,
          { cause: error },
        )
      }
      this.#context = await this.#browser.newContext()
      this.#page = await this.#context.newPage()
      this.#page.on("pageerror", (error) => {
        this.#pageError = error
      })
      await abortable(this.#page.goto(this.#server.url, { waitUntil: "load" }), signal, () =>
        this.cancel(),
      )
      await abortable(
        this.#page.waitForFunction(
          () => Boolean((globalThis as unknown as BrowserGlobal).__yugilifeCli),
          undefined,
          { timeout: rendererReadyTimeoutMs },
        ),
        signal,
        () => this.cancel(),
      )
    } catch (error) {
      const detail = this.#pageError?.message
      await this.close()
      if (error instanceof CliError) throw error
      throw new CliError(
        "HARNESS_UNAVAILABLE",
        detail
          ? `The browser renderer failed to load: ${detail}`
          : "The browser renderer failed to load.",
        { cause: error },
      )
    }
  }

  async smoke(signal?: AbortSignal): Promise<BrowserSmokeResult> {
    const page = this.#page
    if (!page) throw new CliError("HARNESS_UNAVAILABLE", "The browser host has not started.")
    try {
      const evaluation = page.evaluate(async () => {
        const api = (globalThis as unknown as BrowserGlobal).__yugilifeCli
        if (!api) throw new Error("The YugiLife browser API is unavailable.")
        return await api.smoke()
      })
      return await abortable(evaluation, signal, () => this.cancel())
    } catch (error) {
      if (error instanceof CliError) throw error
      throw new CliError("HARNESS_UNAVAILABLE", "The browser smoke check failed.", {
        cause: error,
      })
    }
  }

  async render(
    request: SerializedRenderRequest,
    signal?: AbortSignal,
  ): Promise<BrowserRenderSuccess> {
    const page = this.#page
    if (!page) throw new CliError("HARNESS_UNAVAILABLE", "The browser host has not started.")
    try {
      const evaluation = page.evaluate(async (renderRequest) => {
        const api = (globalThis as unknown as BrowserGlobal).__yugilifeCli
        if (!api) throw new Error("The YugiLife browser API is unavailable.")
        return await api.render(renderRequest)
      }, request)
      const response = await abortable(evaluation, signal, () => this.cancel())
      if (!response.ok) {
        if (response.error.code === "ABORTED") {
          throw new CliError("CLI_INTERRUPTED", response.error.message)
        }
        if (response.error.code === "RENDER_VALIDATION_FAILED") {
          throw new CliError("RENDER_VALIDATION_FAILED", response.error.message)
        }
        throw new CliError("RENDER_FAILED", response.error.message)
      }
      return response
    } catch (error) {
      if (error instanceof CliError) throw error
      throw new CliError("HARNESS_UNAVAILABLE", "The browser renderer stopped unexpectedly.", {
        cause: error,
      })
    }
  }

  cancel() {
    const page = this.#page
    if (!page) return
    void page
      .evaluate(() => (globalThis as unknown as BrowserGlobal).__yugilifeCli?.cancel())
      .catch(() => undefined)
  }

  async close() {
    if (this.#closing) return
    this.#closing = true
    this.cancel()
    const page = this.#page
    const context = this.#context
    const browser = this.#browser
    const server = this.#server
    this.#page = undefined
    this.#context = undefined
    this.#browser = undefined
    this.#server = undefined
    await Promise.allSettled([page?.close(), context?.close(), browser?.close(), server?.close()])
  }
}

export async function readCoreVersion() {
  const packageJsonPath = path.join(getCoreDistributionPath(), "..", "package.json")
  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version?: unknown }
    return typeof packageJson.version === "string" ? packageJson.version : "unknown"
  } catch {
    return "unknown"
  }
}
