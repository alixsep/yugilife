import { callSync } from "./core/sync"

import type { CardDimensions, RasterOutputSize } from "./contracts/index.js"

export function resolveRasterOutputDimensions(
  dimensions: CardDimensions,
  size?: RasterOutputSize,
): CardDimensions {
  return callSync("resolveRasterOutputDimensions", {
    dimensions,
    ...(size === undefined ? {} : { size }),
  })
}
