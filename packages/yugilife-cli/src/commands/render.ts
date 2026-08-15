import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { BrowserHost } from "../runtime/browser-host.js"
import { CliError } from "../runtime/errors.js"
import { decodeRasterDataUrl, loadRenderRequest } from "../runtime/input.js"

export async function runRender(
  inputPath: string,
  outputPath: string,
  options: {
    readonly backgroundColor?: string
    readonly height?: number
    readonly quality?: number
    readonly scale?: number
    readonly signal?: AbortSignal
    readonly templateReference?: string
    readonly textMode?: "paths" | "text"
    readonly title?: string
    readonly useDefaultTemplate?: boolean
    readonly width?: number
  } = {},
) {
  const resolvedOutputPath = path.resolve(outputPath)
  const request = await loadRenderRequest(inputPath, resolvedOutputPath, options)
  const host = new BrowserHost()
  try {
    await host.start(options.signal)
    const response = await host.render(request, options.signal)
    try {
      await mkdir(path.dirname(resolvedOutputPath), { recursive: true })
      await writeFile(
        resolvedOutputPath,
        response.format === "svg"
          ? response.payload
          : decodeRasterDataUrl(response.payload, response.format, outputPath),
      )
    } catch (error) {
      throw new CliError("OUTPUT_WRITE_FAILED", `Could not write output "${outputPath}".`, {
        cause: error,
      })
    }
    return response.warnings
  } finally {
    await host.close()
  }
}
