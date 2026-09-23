/** Bilinear coverage resampling using pixel centers; accepts alpha planes or an RGBA channel. */
export function resampleAlpha(
  source: Uint8Array | Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  stride = 1,
  channel = 0,
): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(width * height)
  const xRatio = sourceWidth / width
  const yRatio = sourceHeight / height
  for (let y = 0; y < height; y += 1) {
    const sy = Math.max(0, Math.min(sourceHeight - 1, (y + 0.5) * yRatio - 0.5))
    const top = Math.floor(sy)
    const bottom = Math.min(sourceHeight - 1, top + 1)
    const wy = sy - top
    for (let x = 0; x < width; x += 1) {
      const sx = Math.max(0, Math.min(sourceWidth - 1, (x + 0.5) * xRatio - 0.5))
      const left = Math.floor(sx)
      const right = Math.min(sourceWidth - 1, left + 1)
      const wx = sx - left
      const a =
        source[(top * sourceWidth + left) * stride + channel]! * (1 - wx) +
        source[(top * sourceWidth + right) * stride + channel]! * wx
      const b =
        source[(bottom * sourceWidth + left) * stride + channel]! * (1 - wx) +
        source[(bottom * sourceWidth + right) * stride + channel]! * wx
      output[y * width + x] = Math.round(a * (1 - wy) + b * wy)
    }
  }
  return output
}
