import { resampleAlpha } from "@/lib/pin-mask/resample-alpha"

import type {
  ArtworkMaskChannel,
  ProcessedArtworkMaskPixels,
} from "@/lib/pin-mask/artwork-mask-effects"

export interface ArtworkWorkspaceSource {
  artwork: ImageBitmap
  mask?: ImageBitmap
}

/**
 * The artwork pane is a display surface, not an export surface. Keeping its backing canvas
 * bounded prevents a large uploaded source from allocating several native-size RGBA canvases just
 * to show a few hundred CSS pixels in the playground. Core/export still receives the native mask.
 */
const MAX_WORKSPACE_DIMENSION = 1024

export function workspaceDimensions(sourceWidth: number, sourceHeight: number) {
  const longest = Math.max(sourceWidth, sourceHeight)
  if (longest <= MAX_WORKSPACE_DIMENSION) {
    return { height: sourceHeight, width: sourceWidth }
  }
  const ratio = MAX_WORKSPACE_DIMENSION / longest
  return {
    height: Math.max(1, Math.round(sourceHeight * ratio)),
    width: Math.max(1, Math.round(sourceWidth * ratio)),
  }
}

function resampleRgbaMask(
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
) {
  const alpha = resampleAlpha(source, sourceWidth, sourceHeight, width, height, 4, 3)
  const output = new Uint8ClampedArray(width * height * 4).fill(255)
  alpha.forEach((value, index) => {
    output[index * 4 + 3] = value
  })
  return output
}

export async function loadWorkspaceSource(artwork: Blob, mask: Blob | undefined) {
  const [artworkResult, maskResult] = await Promise.allSettled([
    createImageBitmap(artwork),
    mask ? createImageBitmap(mask) : Promise.resolve(undefined),
  ])
  if (artworkResult.status === "rejected") {
    if (maskResult.status === "fulfilled") maskResult.value?.close()
    throw artworkResult.reason
  }
  if (maskResult.status === "rejected") {
    artworkResult.value.close()
    throw maskResult.reason
  }
  const maskBitmap = maskResult.value
  return { artwork: artworkResult.value, ...(maskBitmap ? { mask: maskBitmap } : {}) }
}

/**
 * Draw the workspace treatment into the artwork surface itself. Keeping this in the canvas
 * pipeline means the dimmed mask preview, moving stripes, and pin markers share exactly the same
 * bounds as the artwork instead of making the pane background look like part of the source image.
 */
export function drawWorkspaceStripes(
  context: CanvasRenderingContext2D,
  stripeCanvas: HTMLCanvasElement,
  backgroundMask: HTMLCanvasElement | undefined,
  width: number,
  height: number,
  phase: number,
) {
  const stripeWidth = Math.max(12, Math.round(Math.min(width, height) / 48))
  const cycle = stripeWidth * 2
  const offset = ((phase % cycle) + cycle) % cycle
  const extent = Math.hypot(width, height) * 2
  const stripeContext = stripeCanvas.getContext("2d")
  if (!stripeContext) return

  stripeContext.save()
  stripeContext.globalCompositeOperation = "source-over"
  stripeContext.globalAlpha = 1
  stripeContext.clearRect(0, 0, width, height)
  stripeContext.globalAlpha = 0.16
  stripeContext.translate(width / 2, height / 2)
  stripeContext.rotate(Math.PI / 4)
  for (let position = -extent + offset; position < extent; position += cycle) {
    stripeContext.fillStyle = "#ffffff"
    stripeContext.fillRect(position, -extent, stripeWidth, extent * 2)
    stripeContext.fillStyle = "#000000"
    stripeContext.fillRect(position + stripeWidth, -extent, stripeWidth, extent * 2)
  }
  stripeContext.restore()

  if (backgroundMask) {
    stripeContext.save()
    stripeContext.globalCompositeOperation = "destination-in"
    stripeContext.globalAlpha = 1
    stripeContext.drawImage(backgroundMask, 0, 0)
    stripeContext.restore()
  }
  context.drawImage(stripeCanvas, 0, 0)
}

/**
 * Converts either the database image mask or the live dot selection into core's canonical RGBA
 * mask representation. The alpha channel is foreground coverage; RGB is intentionally white so
 * the same representation can be reused for both dimming and stripe clipping.
 */
export function createWorkspaceMaskPixels(
  source: ArtworkWorkspaceSource,
  width: number,
  height: number,
  maskChannel: ArtworkMaskChannel,
  selection?: Uint8Array,
  displayMask?: ProcessedArtworkMaskPixels,
) {
  if (displayMask) {
    // Worker preview pixels are bounded independently of native artwork/mask dimensions.
    if (displayMask.width === width && displayMask.height === height) return displayMask.pixels
    return resampleRgbaMask(
      displayMask.pixels,
      displayMask.width,
      displayMask.height,
      width,
      height,
    )
  }
  const output = new Uint8ClampedArray(width * height * 4)
  if (selection) {
    if (selection.length !== width * height) {
      throw new Error("The dot mask selection has unexpected dimensions.")
    }
    for (let index = 0; index < selection.length; index += 1) {
      const offset = index * 4
      output[offset] = 255
      output[offset + 1] = 255
      output[offset + 2] = 255
      output[offset + 3] = selection[index]!
    }
    return output
  }
  const maskBitmap = source.mask
  if (!maskBitmap) return undefined

  const maskCanvas = document.createElement("canvas")
  maskCanvas.width = width
  maskCanvas.height = height
  const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true })
  if (!maskContext) return undefined
  maskContext.drawImage(maskBitmap, 0, 0, width, height)
  const pixels = maskContext.getImageData(0, 0, width, height)
  if (maskChannel === "luminance") {
    for (let index = 0; index < pixels.data.length; index += 4) {
      const luminance =
        pixels.data[index]! * 0.2126 +
        pixels.data[index + 1]! * 0.7152 +
        pixels.data[index + 2]! * 0.0722
      pixels.data[index + 3] = Math.round((luminance * pixels.data[index + 3]!) / 255)
    }
  }
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4
    const foreground = pixels.data[offset + 3]!
    output[offset] = 255
    output[offset + 1] = 255
    output[offset + 2] = 255
    output[offset + 3] = Math.round(foreground)
  }
  return output
}

interface WorkspaceMaskSurfaces {
  /** Opaque grayscale coverage used with multiply to dim the background. */
  readonly foreground: HTMLCanvasElement
  /** Transparent outside-background coverage used to destination-in the stripes. */
  readonly background: HTMLCanvasElement
}

/** Builds the two canvas views needed by the workspace from one processed foreground alpha plane. */
export function createWorkspaceMaskSurfaces(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): WorkspaceMaskSurfaces | undefined {
  const foreground = document.createElement("canvas")
  const background = document.createElement("canvas")
  foreground.width = width
  foreground.height = height
  background.width = width
  background.height = height
  const foregroundContext = foreground.getContext("2d")
  const backgroundContext = background.getContext("2d")
  if (!foregroundContext || !backgroundContext) return undefined
  const foregroundImage = foregroundContext.createImageData(width, height)
  for (let index = 0; index < width * height; index += 1) {
    const sourceOffset = index * 4
    const foregroundAlpha = pixels[sourceOffset + 3] ?? 0
    foregroundImage.data[sourceOffset] = foregroundAlpha
    foregroundImage.data[sourceOffset + 1] = foregroundAlpha
    foregroundImage.data[sourceOffset + 2] = foregroundAlpha
    foregroundImage.data[sourceOffset + 3] = 255
  }
  foregroundContext.putImageData(foregroundImage, 0, 0)
  // Reuse the same CPU-side ImageData for the inverse coverage. The foreground canvas already
  // owns its uploaded pixels, so keeping a second native-size ImageData alive only increases the
  // peak during a mask-effects update.
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4
    const foregroundAlpha = pixels[offset + 3] ?? 0
    foregroundImage.data[offset] = 255
    foregroundImage.data[offset + 1] = 255
    foregroundImage.data[offset + 2] = 255
    foregroundImage.data[offset + 3] = 255 - foregroundAlpha
  }
  backgroundContext.putImageData(foregroundImage, 0, 0)
  return { background, foreground }
}
