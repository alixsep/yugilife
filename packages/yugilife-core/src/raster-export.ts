import { throwIfAborted } from "./rendering/assets.js"

import type {
  CardDimensions,
  RasterExportOptions,
  RasterImageFormat,
  RasterOutputSize,
} from "./contracts/index.js"

const maximumRasterEdge = 16_384
const maximumRasterPixels = 64_000_000
const defaultLossyQuality = 0.92
const opaqueHexColorPattern = /^#(?:[\da-f]{3}|[\da-f]{6})$/iu

const mimeTypes: Readonly<Record<RasterImageFormat, string>> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
}

function positiveFinite(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be finite and greater than zero; received ${value}.`)
  }
}

function positiveInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer; received ${value}.`)
  }
}

function assertOutputBudget({ height, width }: CardDimensions) {
  if (width > maximumRasterEdge || height > maximumRasterEdge) {
    throw new RangeError(`Raster output dimensions cannot exceed ${maximumRasterEdge} pixels.`)
  }
  if (width * height > maximumRasterPixels) {
    throw new RangeError(`Raster output cannot exceed ${maximumRasterPixels} pixels.`)
  }
}

export function resolveRasterOutputDimensions(
  dimensions: CardDimensions,
  size?: RasterOutputSize,
): CardDimensions {
  positiveFinite(dimensions.width, "Template width")
  positiveFinite(dimensions.height, "Template height")
  let width = Math.round(dimensions.width)
  let height = Math.round(dimensions.height)
  if (size !== undefined) {
    if (size === null || typeof size !== "object" || Array.isArray(size)) {
      throw new RangeError("Raster output size must be an object.")
    }
    const keys = Object.keys(size)
    if (keys.length !== 1 || !["height", "scale", "width"].includes(keys[0] ?? "")) {
      throw new RangeError(
        "Raster output size must specify exactly one of height, scale, or width.",
      )
    }
    if ("scale" in size && size.scale !== undefined) {
      positiveFinite(size.scale, "Raster output scale")
      width = Math.round(dimensions.width * size.scale)
      height = Math.round(dimensions.height * size.scale)
    } else if ("width" in size && size.width !== undefined) {
      positiveInteger(size.width, "Raster output width")
      width = size.width
      height = Math.round((dimensions.height * width) / dimensions.width)
    } else if ("height" in size && size.height !== undefined) {
      positiveInteger(size.height, "Raster output height")
      height = size.height
      width = Math.round((dimensions.width * height) / dimensions.height)
    }
  }
  if (width < 1 || height < 1) {
    throw new RangeError("Raster output size produces a dimension smaller than one pixel.")
  }
  const output = { height, width }
  assertOutputBudget(output)
  return output
}

function rasterOptions(options?: RasterExportOptions) {
  const requestedFormat: unknown = options?.format ?? "png"
  if (typeof requestedFormat !== "string" || !Object.hasOwn(mimeTypes, requestedFormat)) {
    throw new RangeError(`Unsupported raster image format ${String(requestedFormat)}.`)
  }
  const format = requestedFormat as RasterImageFormat
  const quality = options?.quality
  if (quality !== undefined) {
    if (format === "png") throw new RangeError("PNG output does not accept a quality value.")
    if (!Number.isFinite(quality) || quality < 0 || quality > 1) {
      throw new RangeError(`Raster output quality must be from 0 through 1; received ${quality}.`)
    }
  }
  const backgroundColor = options?.backgroundColor
  if (backgroundColor !== undefined && format !== "jpeg") {
    throw new RangeError("A raster background color is supported only for JPEG output.")
  }
  const jpegBackground = backgroundColor ?? "#ffffff"
  if (format === "jpeg" && !opaqueHexColorPattern.test(jpegBackground)) {
    throw new RangeError("JPEG backgroundColor must be an opaque #RGB or #RRGGBB color.")
  }
  return {
    backgroundColor: jpegBackground,
    format,
    mimeType: mimeTypes[format],
    quality: format === "png" ? undefined : (quality ?? defaultLossyQuality),
  }
}

function abortReason(signal?: AbortSignal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("Rendering was aborted.", "AbortError")
}

function loadSvg(svg: string, signal?: AbortSignal) {
  throwIfAborted(signal)
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }))
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    const cleanup = () => signal?.removeEventListener("abort", abort)
    const abort = () => {
      cleanup()
      image.src = ""
      reject(abortReason(signal))
    }
    image.addEventListener(
      "load",
      () => {
        cleanup()
        resolve(image)
      },
      { once: true },
    )
    image.addEventListener(
      "error",
      () => {
        cleanup()
        reject(new Error("Could not rasterize the rendered SVG for image output."))
      },
      { once: true },
    )
    signal?.addEventListener("abort", abort, { once: true })
    image.src = url
  })
  return { promise, revoke: () => URL.revokeObjectURL(url) }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  options: ReturnType<typeof rasterOptions>,
  signal?: AbortSignal,
) {
  throwIfAborted(signal)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        try {
          throwIfAborted(signal)
          if (!blob)
            throw new Error(`The browser could not encode ${options.format.toUpperCase()} output.`)
          if (blob.type !== options.mimeType) {
            throw new Error(
              `The browser does not support ${options.format.toUpperCase()} canvas encoding; it returned ${blob.type || "an unknown format"}.`,
            )
          }
          resolve(blob)
        } catch (error) {
          reject(error instanceof Error ? error : new Error("Raster image encoding failed."))
        }
      },
      options.mimeType,
      options.quality,
    )
  })
}

function createRasterSurface(dimensions: CardDimensions) {
  const canvas = document.createElement("canvas")
  canvas.width = dimensions.width
  canvas.height = dimensions.height
  if (canvas.width !== dimensions.width || canvas.height !== dimensions.height) {
    throw new RangeError("The browser could not allocate the requested raster output dimensions.")
  }
  const context = canvas.getContext("2d")
  if (!context) throw new Error("A 2D canvas context is required for raster image output.")
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = "high"
  return { canvas, context }
}

export async function rasterizeCardSvgToImage(
  svg: string,
  dimensions: CardDimensions,
  options?: RasterExportOptions,
  signal?: AbortSignal,
) {
  const output = resolveRasterOutputDimensions(dimensions, options?.size)
  const encoding = rasterOptions(options)
  const source = loadSvg(svg, signal)
  try {
    const image = await source.promise
    throwIfAborted(signal)
    const native = resolveRasterOutputDimensions(dimensions)
    let drawable: CanvasImageSource = image
    if (output.width < native.width && output.height < native.height) {
      const nativeSurface = createRasterSurface(native)
      nativeSurface.context.drawImage(image, 0, 0, native.width, native.height)
      drawable = nativeSurface.canvas
      throwIfAborted(signal)
    }
    const { canvas, context } = createRasterSurface(output)
    if (encoding.format === "jpeg") {
      context.fillStyle = encoding.backgroundColor
      context.fillRect(0, 0, output.width, output.height)
    }
    context.drawImage(drawable, 0, 0, output.width, output.height)
    return await canvasToBlob(canvas, encoding, signal)
  } finally {
    source.revoke()
  }
}
