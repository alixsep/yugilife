import { rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
await rm(path.join(packageDirectory, "dist"), { force: true, recursive: true })
