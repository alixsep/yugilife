import { mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { build } from "esbuild"

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const outputFile = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(packageDirectory, "dist/fontkit-runtime.js")

await mkdir(path.dirname(outputFile), { recursive: true })

await build({
  absWorkingDir: packageDirectory,
  bundle: true,
  entryPoints: ["node_modules/fontkit/dist/browser-module.mjs"],
  format: "esm",
  minify: false,
  outfile: outputFile,
  platform: "browser",
  sourcemap: false,
  target: "es2022",
})

console.log(`Built the separate fontkit browser runtime at ${outputFile}`)
