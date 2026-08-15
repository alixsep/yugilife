import path from "node:path"
import { fileURLToPath } from "node:url"

const appDirectory = path.dirname(fileURLToPath(import.meta.url))
const appSource = path.resolve(appDirectory, "src")
const coreSource = path.resolve(appDirectory, "../../packages/yugilife-core/src")
const templatesSource = path.resolve(appDirectory, "../../packages/yugilife-templates/src")

/**
 * Single source of truth for how the app resolves local and workspace imports. Vite, Vitest,
 * and the tsconfig `paths` must agree, otherwise they read different code.
 */
export const workspaceAliases = [
  { find: "@", replacement: appSource },
  { find: /^yugilife-core$/, replacement: path.join(coreSource, "index.ts") },
  { find: /^yugilife-core\/advanced$/, replacement: path.join(coreSource, "advanced.ts") },
  {
    find: /^yugilife-core\/color-grading$/,
    replacement: path.join(coreSource, "public/color-grading.ts"),
  },
  { find: /^yugilife-templates$/, replacement: path.join(templatesSource, "index.ts") },
]
