/** Worker-only encoding: preserve the existing opaque grayscale manual-mask format. */
export async function encodePinMask(mask: Uint8Array, width: number, height: number) {
  if (mask.length !== width * height) throw new Error("The pin mask dimensions are invalid.")
  const canvas = new OffscreenCanvas(width, height)
  try {
    const context = canvas.getContext("2d")
    if (!context) throw new Error("A 2D canvas is required to encode the pin mask.")
    const pixels = context.createImageData(width, height)
    for (let index = 0; index < mask.length; index += 1) {
      const offset = index * 4
      pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = mask[index]!
      pixels.data[offset + 3] = 255
    }
    context.putImageData(pixels, 0, 0)
    return await canvas.convertToBlob({ type: "image/png" })
  } finally {
    canvas.width = canvas.height = 1
  }
}
