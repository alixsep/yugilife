import { stat } from "node:fs/promises"
import path from "node:path"

import sharp from "sharp"

import { packageDirectory } from "./paths.mjs"

const rasterImageExtension = /\.(?:jpe?g|png|webp)$/i

export function isYugilifeRasterImage(file) {
  const relative = path.relative(packageDirectory, file)
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative) &&
    rasterImageExtension.test(file)
  )
}

export function losslessWebpFileName(file) {
  if (!rasterImageExtension.test(file)) {
    throw new Error(`Cannot convert non-raster asset "${file}" to WebP.`)
  }
  return file.replace(rasterImageExtension, ".webp")
}

export async function convertToLosslessWebp(source) {
  return sharp(source).webp({ lossless: true }).toBuffer()
}

const devPrefix = "/@yugilife-lossless-webp/"

/**
 * Template raster images are served as lossless WebP in development as well as in builds. The
 * visible pixels are the same either way, but the renderer premultiplies alpha the way Chromium
 * does for each format, so a PNG and its WebP differ by a level on semi-transparent edges. Serving
 * PNG in development would make the dev server, and the visual suite that runs on it, draw
 * slightly different cards than the build and the CLI.
 */
export function yugilifeLosslessWebp() {
  let serving = false
  const converted = new Map()

  async function convertedFile(sourceFile) {
    const { mtimeMs } = await stat(sourceFile)
    const cached = converted.get(sourceFile)
    if (cached?.mtimeMs === mtimeMs) return await cached.bytes
    const bytes = convertToLosslessWebp(sourceFile)
    converted.set(sourceFile, { bytes, mtimeMs })
    return await bytes
  }

  return {
    name: "yugilife-lossless-webp",
    enforce: "pre",

    configResolved(config) {
      serving = config.command === "serve"
    },

    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = request.url ?? ""
        if (!url.startsWith(devPrefix)) return next()
        const sourceFile = decodeURIComponent(url.slice(devPrefix.length).split("?", 1)[0])
        if (!isYugilifeRasterImage(sourceFile)) return next()
        try {
          const bytes = await convertedFile(sourceFile)
          response.setHeader("Content-Type", "image/webp")
          response.setHeader("Cache-Control", "no-cache")
          response.end(bytes)
        } catch (error) {
          next(error)
        }
      })
    },

    async load(id) {
      const sourceFile = id.split("?", 1)[0]
      if (!isYugilifeRasterImage(sourceFile)) return null

      if (serving) {
        this.addWatchFile(sourceFile)
        const url = `${devPrefix}${encodeURIComponent(sourceFile)}`
        return `export default ${JSON.stringify(url)};`
      }

      const outputFile = losslessWebpFileName(sourceFile)
      const referenceId = this.emitFile({
        type: "asset",
        name: path.basename(outputFile),
        originalFileName: outputFile,
        source: await convertToLosslessWebp(sourceFile),
      })

      return `export default import.meta.ROLLUP_FILE_URL_${referenceId};`
    },
  }
}
