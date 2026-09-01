import type { CardRenderedTextField } from "@/components/card"

function renderedTextElements(root: HTMLElement, fields: readonly CardRenderedTextField[]) {
  const card = root.querySelector<HTMLElement>(":scope > [role='img']")
  if (!card) return []
  return fields.flatMap((target) => {
    const { elementIndex, segmentIndex } = target
    const segment = card.children.item(segmentIndex)
    if (!(segment instanceof SVGSVGElement)) return []
    const element = segment.children.item(elementIndex)
    return element instanceof SVGGraphicsElement ? [{ element, target }] : []
  })
}

/** Finds the highest rendered text outline whose browser-computed SVG box contains the pointer. */
export function renderedTextFieldAt(
  root: HTMLElement,
  fields: readonly CardRenderedTextField[],
  clientX: number,
  clientY: number,
) {
  const candidates = renderedTextElements(root, fields)
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]
    if (!candidate) continue
    const bounds = candidate.element.getBoundingClientRect()
    if (
      clientX >= bounds.left &&
      clientY >= bounds.top &&
      clientX < bounds.right &&
      clientY < bounds.bottom
    ) {
      return candidate.target
    }
  }
  return undefined
}

export function renderedTextBounds(
  root: HTMLElement,
  fields: readonly CardRenderedTextField[],
  cardWidth: number,
  cardHeight: number,
) {
  const card = root.getBoundingClientRect()
  if (card.width <= 0 || card.height <= 0) return []
  return renderedTextElements(root, fields)
    .map(({ element, target }) => {
      const bounds = element.getBoundingClientRect()
      return {
        field: target.field,
        region: {
          height: (bounds.height / card.height) * cardHeight,
          width: (bounds.width / card.width) * cardWidth,
          x: ((bounds.left - card.left) / card.width) * cardWidth,
          y: ((bounds.top - card.top) / card.height) * cardHeight,
        },
      }
    })
    .filter(({ field, region }) => field && region.width > 0 && region.height > 0)
}
