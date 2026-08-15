import { chmod } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

if (process.platform !== "win32") {
  await chmod(path.join(packageDirectory, "dist/cli.js"), 0o755)
}
