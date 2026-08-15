import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import wawoff2 from "wawoff2"

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const convertibleFontExtension = /\.(?:ttf|otf)$/i

function isInsidePackage(file) {
  const relative = path.relative(packageDirectory, file)

  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

export function isYugilifeConvertibleFont(file) {
  return isInsidePackage(file) && convertibleFontExtension.test(file)
}

export function woff2FileName(file) {
  if (!convertibleFontExtension.test(file)) {
    throw new Error(`Cannot convert non-TTF/OTF font "${file}" to WOFF2.`)
  }

  return file.replace(convertibleFontExtension, ".woff2")
}

export async function convertToWoff2(sourceFile) {
  const source = await fs.readFile(sourceFile)

  // wawoff2 returns a Uint8Array/Buffer-compatible value.
  return Buffer.from(await wawoff2.compress(source))
}

export function yugilifeWoff2() {
  return {
    name: "yugilife-woff2",
    apply: "build",
    enforce: "pre",

    async load(id) {
      const sourceFile = id.split("?", 1)[0]

      if (!isYugilifeConvertibleFont(sourceFile)) {
        return null
      }

      const outputFile = woff2FileName(sourceFile)

      const referenceId = this.emitFile({
        type: "asset",
        name: path.basename(outputFile),
        originalFileName: outputFile,
        source: await convertToWoff2(sourceFile),
      })

      return `export default import.meta.ROLLUP_FILE_URL_${referenceId};`
    },
  }
}
