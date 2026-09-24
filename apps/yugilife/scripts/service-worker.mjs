import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"

/**
 * Emits `sw.js` into the build, stamped with a hash of the build's own file names. Those names carry
 * content hashes, so any change to the app yields a new worker, which is what makes every deploy
 * replace the previous one. Nothing is emitted in development.
 *
 * @returns {import("vite").Plugin}
 */
export function yugilifeServiceWorker() {
  return {
    apply: "build",
    name: "yugilife-service-worker",

    async generateBundle(_options, bundle) {
      const build = createHash("sha256")
        .update(Object.keys(bundle).sort().join("\n"))
        .digest("hex")
        .slice(0, 16)
      const source = await readFile(new URL("./service-worker.js", import.meta.url), "utf8")
      this.emitFile({
        fileName: "sw.js",
        source: source.replace(`"__YUGILIFE_BUILD__"`, JSON.stringify(build)),
        type: "asset",
      })
    },
  }
}
