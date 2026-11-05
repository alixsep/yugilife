import { callSync } from "./core/sync"

export function isTemplateVersion(value: unknown): value is string {
  return typeof value === "string" && callSync<boolean>("isTemplateVersion", { value })
}

/** The first difference between two versions' parts: negative when `left` is older. */
export function compareTemplateVersions(left: string, right: string): number {
  return callSync<number | null>("compareTemplateVersions", { left, right }) ?? Number.NaN
}
