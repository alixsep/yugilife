export const DASHED_BORDER_STROKE_WIDTH = 1
export const ARTWORK_ATTACHMENT_OVERLAP_PX = 8

/**
 * The shape context exposes classes rather than numeric radii. Keeping the
 * geometry mapping here gives SVG surfaces and CSS surfaces one source of
 * truth for their corner construction.
 */
export function getShapeContainerRadius(container: string) {
  return container === "rounded-3xl" ? 24 : 12
}

/**
 * Builds the fill boundary for the full-art attachment. Its top edge follows
 * the outside edge of the artwork input's rounded dashed border: the two
 * quarter-arcs are concave from the attachment's filled area and remain true
 * circles because the path is emitted in measured CSS pixels.
 */
export function buildConcaveAttachmentPath({
  height,
  overlap,
  radius,
  strokeWidth = DASHED_BORDER_STROKE_WIDTH,
  width,
}: {
  height: number
  overlap: number
  radius: number
  strokeWidth?: number
  width: number
}) {
  // SVG rounded rectangles clamp radii that exceed half the available width;
  // mirror that behavior so narrow responsive inputs cannot produce looping
  // or self-intersecting attachment arcs.
  const edgeRadius = Math.min(radius + strokeWidth / 2, width / 2)
  const cornerY = overlap - edgeRadius

  return [
    `M 0 ${cornerY}`,
    `A ${edgeRadius} ${edgeRadius} 0 0 0 ${edgeRadius} ${overlap}`,
    `H ${width - edgeRadius}`,
    `A ${edgeRadius} ${edgeRadius} 0 0 0 ${width} ${cornerY}`,
    `V ${height}`,
    "H 0",
    "Z",
  ].join(" ")
}
