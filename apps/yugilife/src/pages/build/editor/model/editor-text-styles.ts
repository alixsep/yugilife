import type { ResolvedTextPresentation } from "yugilife-core"

/**
 * One resolved text style with every control that applies to it.
 *
 * The three capability lists (fitting, compression, paint) are independent projections of the same
 * resolved styles, so rendering them one after another repeats a style's name once per list and
 * hides the fact that the controls belong together. Grouping them restores the subject — the style
 * — as the unit the editor is organized around.
 */
export interface EditorTextStyleGroup {
  /** Identity of the *resolved* style: one layer resolves to different styles across card states. */
  key: string
  compression: boolean
  fit: boolean
  layerId: string
  paint: boolean
  style: ResolvedTextPresentation
  styleId: string
  styleLabel: string
}

function styleKey({ layerId, styleId }: ResolvedTextPresentation) {
  return `${layerId}:${styleId}`
}

/**
 * Merges the capability lists into one group per resolved style.
 *
 * `paintable` leads because it is the broadest list and is already in template layer order; styles
 * that only appear in the narrower lists keep their own relative order after it.
 */
export function groupEditorTextStyles(
  fitted: readonly ResolvedTextPresentation[],
  compressible: readonly ResolvedTextPresentation[],
  paintable: readonly ResolvedTextPresentation[],
): EditorTextStyleGroup[] {
  const groups = new Map<string, EditorTextStyleGroup>()
  const capabilities = [
    { entries: paintable, name: "paint" },
    { entries: fitted, name: "fit" },
    { entries: compressible, name: "compression" },
  ] as const

  for (const { entries, name } of capabilities) {
    for (const style of entries) {
      const key = styleKey(style)
      const group = groups.get(key) ?? {
        key,
        compression: false,
        fit: false,
        layerId: style.layerId,
        paint: false,
        // The lists resolve from the same presentation, so any of them carries the same typography.
        style,
        styleId: style.styleId,
        styleLabel: style.styleLabel,
      }
      groups.set(key, {
        ...group,
        compression: group.compression || name === "compression",
        fit: group.fit || name === "fit",
        paint: group.paint || name === "paint",
      })
    }
  }

  return [...groups.values()]
}
