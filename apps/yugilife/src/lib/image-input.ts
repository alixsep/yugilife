export const maximumImageInputBytes = 32 * 1024 * 1024
export const maximumImagePixels = 16_777_216

export async function inspectImageInput(source: Blob) {
  if (source.size > maximumImageInputBytes) throw new Error("Choose an image smaller than 32 MiB.")
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(source)
  } catch {
    throw new Error(
      "This file could not be decoded as an image. Choose a PNG, JPEG, WebP, or AVIF image.",
    )
  }
  try {
    const { width, height } = bitmap
    if (width * height > maximumImagePixels || width > 8192 || height > 8192) {
      throw new Error(
        "Choose an image with at most 16 megapixels and no side longer than 8192 pixels.",
      )
    }
    return { width, height }
  } finally {
    bitmap.close()
  }
}
