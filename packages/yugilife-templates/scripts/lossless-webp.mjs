import path from "node:path"
import { fileURLToPath } from "node:url"

import sharp from "sharp"

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
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

export function yugilifeLosslessWebp() {
  return {
    name: "yugilife-lossless-webp",
    apply: "build",
    enforce: "pre",

    async load(id) {
      const sourceFile = id.split("?", 1)[0]
      if (!isYugilifeRasterImage(sourceFile)) return null

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
