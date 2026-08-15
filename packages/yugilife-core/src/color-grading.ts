import { tryGpuPolynomialGrading } from "./gpu-color-grading.js"
import { validateColorPresetShape } from "./template-shape.js"

import type { ColorPreset, PolynomialColorPreset } from "./contracts/index.js"

export interface PixelImageData {
  data: Uint8ClampedArray
}

export interface SourceRectangle {
  height: number
  width: number
  x: number
  y: number
}

const canonicalExponents: readonly (readonly number[])[] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [2, 0, 0],
  [1, 1, 0],
  [1, 0, 1],
  [0, 2, 0],
  [0, 1, 1],
  [0, 0, 2],
  [3, 0, 0],
  [2, 1, 0],
  [2, 0, 1],
  [1, 2, 0],
  [1, 1, 1],
  [1, 0, 2],
  [0, 3, 0],
  [0, 2, 1],
  [0, 1, 2],
  [0, 0, 3],
]

function hasCanonicalBasis(exponents: readonly (readonly number[])[]) {
  return (
    [4, 10, 20].includes(exponents.length) &&
    exponents.every((exponent, index) =>
      exponent.every((power, channel) => power === canonicalExponents[index]?.[channel]),
    )
  )
}

function applyCanonicalPolynomialPreset(imageData: PixelImageData, preset: PolynomialColorPreset) {
  // Full-card textures contain nearly one million pixels. Keep the calibrated 4/10/20-term bases
  // on an allocation-free, branch-free inner loop instead of doing a nested term/channel walk for
  // every pixel. Terms stay in canonical order so rounding remains byte-identical to the generic
  // evaluator below.
  const pixels = imageData.data
  const termCount = preset.exponents.length
  const coefficients = new Float64Array(termCount * 3)
  for (let term = 0; term < termCount; term += 1) {
    const source = preset.coefficients[term]
    const offset = term * 3
    coefficients[offset] = source?.[0] ?? 0
    coefficients[offset + 1] = source?.[1] ?? 0
    coefficients[offset + 2] = source?.[2] ?? 0
  }

  if (termCount === 4) {
    for (let index = 0; index < pixels.length; index += 4) {
      const red = (pixels[index] ?? 0) / 255
      const green = (pixels[index + 1] ?? 0) / 255
      const blue = (pixels[index + 2] ?? 0) / 255
      const outputRed =
        coefficients[0]! +
        red * coefficients[3]! +
        green * coefficients[6]! +
        blue * coefficients[9]!
      const outputGreen =
        coefficients[1]! +
        red * coefficients[4]! +
        green * coefficients[7]! +
        blue * coefficients[10]!
      const outputBlue =
        coefficients[2]! +
        red * coefficients[5]! +
        green * coefficients[8]! +
        blue * coefficients[11]!
      pixels[index] = Math.max(0, Math.min(255, Math.round(outputRed * 255)))
      pixels[index + 1] = Math.max(0, Math.min(255, Math.round(outputGreen * 255)))
      pixels[index + 2] = Math.max(0, Math.min(255, Math.round(outputBlue * 255)))
    }
    return
  }

  if (termCount === 10) {
    for (let index = 0; index < pixels.length; index += 4) {
      const red = (pixels[index] ?? 0) / 255
      const green = (pixels[index + 1] ?? 0) / 255
      const blue = (pixels[index + 2] ?? 0) / 255
      const redSquared = red * red
      const greenSquared = green * green
      const blueSquared = blue * blue
      const redGreen = red * green
      const redBlue = red * blue
      const greenBlue = green * blue
      const outputRed =
        coefficients[0]! +
        red * coefficients[3]! +
        green * coefficients[6]! +
        blue * coefficients[9]! +
        redSquared * coefficients[12]! +
        redGreen * coefficients[15]! +
        redBlue * coefficients[18]! +
        greenSquared * coefficients[21]! +
        greenBlue * coefficients[24]! +
        blueSquared * coefficients[27]!
      const outputGreen =
        coefficients[1]! +
        red * coefficients[4]! +
        green * coefficients[7]! +
        blue * coefficients[10]! +
        redSquared * coefficients[13]! +
        redGreen * coefficients[16]! +
        redBlue * coefficients[19]! +
        greenSquared * coefficients[22]! +
        greenBlue * coefficients[25]! +
        blueSquared * coefficients[28]!
      const outputBlue =
        coefficients[2]! +
        red * coefficients[5]! +
        green * coefficients[8]! +
        blue * coefficients[11]! +
        redSquared * coefficients[14]! +
        redGreen * coefficients[17]! +
        redBlue * coefficients[20]! +
        greenSquared * coefficients[23]! +
        greenBlue * coefficients[26]! +
        blueSquared * coefficients[29]!
      pixels[index] = Math.max(0, Math.min(255, Math.round(outputRed * 255)))
      pixels[index + 1] = Math.max(0, Math.min(255, Math.round(outputGreen * 255)))
      pixels[index + 2] = Math.max(0, Math.min(255, Math.round(outputBlue * 255)))
    }
    return
  }

  for (let index = 0; index < pixels.length; index += 4) {
    const red = (pixels[index] ?? 0) / 255
    const green = (pixels[index + 1] ?? 0) / 255
    const blue = (pixels[index + 2] ?? 0) / 255
    const redSquared = red * red
    const greenSquared = green * green
    const blueSquared = blue * blue
    const redGreen = red * green
    const redBlue = red * blue
    const greenBlue = green * blue
    const redCubed = redSquared * red
    const redSquaredGreen = redSquared * green
    const redSquaredBlue = redSquared * blue
    const redGreenSquared = red * greenSquared
    const redGreenBlue = redGreen * blue
    const redBlueSquared = red * blueSquared
    const greenCubed = greenSquared * green
    const greenSquaredBlue = greenSquared * blue
    const greenBlueSquared = green * blueSquared
    const blueCubed = blueSquared * blue
    const outputRed =
      coefficients[0]! +
      red * coefficients[3]! +
      green * coefficients[6]! +
      blue * coefficients[9]! +
      redSquared * coefficients[12]! +
      redGreen * coefficients[15]! +
      redBlue * coefficients[18]! +
      greenSquared * coefficients[21]! +
      greenBlue * coefficients[24]! +
      blueSquared * coefficients[27]! +
      redCubed * coefficients[30]! +
      redSquaredGreen * coefficients[33]! +
      redSquaredBlue * coefficients[36]! +
      redGreenSquared * coefficients[39]! +
      redGreenBlue * coefficients[42]! +
      redBlueSquared * coefficients[45]! +
      greenCubed * coefficients[48]! +
      greenSquaredBlue * coefficients[51]! +
      greenBlueSquared * coefficients[54]! +
      blueCubed * coefficients[57]!
    const outputGreen =
      coefficients[1]! +
      red * coefficients[4]! +
      green * coefficients[7]! +
      blue * coefficients[10]! +
      redSquared * coefficients[13]! +
      redGreen * coefficients[16]! +
      redBlue * coefficients[19]! +
      greenSquared * coefficients[22]! +
      greenBlue * coefficients[25]! +
      blueSquared * coefficients[28]! +
      redCubed * coefficients[31]! +
      redSquaredGreen * coefficients[34]! +
      redSquaredBlue * coefficients[37]! +
      redGreenSquared * coefficients[40]! +
      redGreenBlue * coefficients[43]! +
      redBlueSquared * coefficients[46]! +
      greenCubed * coefficients[49]! +
      greenSquaredBlue * coefficients[52]! +
      greenBlueSquared * coefficients[55]! +
      blueCubed * coefficients[58]!
    const outputBlue =
      coefficients[2]! +
      red * coefficients[5]! +
      green * coefficients[8]! +
      blue * coefficients[11]! +
      redSquared * coefficients[14]! +
      redGreen * coefficients[17]! +
      redBlue * coefficients[20]! +
      greenSquared * coefficients[23]! +
      greenBlue * coefficients[26]! +
      blueSquared * coefficients[29]! +
      redCubed * coefficients[32]! +
      redSquaredGreen * coefficients[35]! +
      redSquaredBlue * coefficients[38]! +
      redGreenSquared * coefficients[41]! +
      redGreenBlue * coefficients[44]! +
      redBlueSquared * coefficients[47]! +
      greenCubed * coefficients[50]! +
      greenSquaredBlue * coefficients[53]! +
      greenBlueSquared * coefficients[56]! +
      blueCubed * coefficients[59]!
    pixels[index] = Math.max(0, Math.min(255, Math.round(outputRed * 255)))
    pixels[index + 1] = Math.max(0, Math.min(255, Math.round(outputGreen * 255)))
    pixels[index + 2] = Math.max(0, Math.min(255, Math.round(outputBlue * 255)))
  }
}

function writeGenericPolynomialOutput(
  pixels: Uint8ClampedArray,
  index: number,
  terms: Float64Array,
  coefficients: readonly (readonly number[])[],
) {
  for (let channel = 0; channel < 3; channel += 1) {
    let value = 0
    for (let term = 0; term < terms.length; term += 1) {
      value += (terms[term] ?? 0) * (coefficients[term]?.[channel] ?? 0)
    }
    pixels[index + channel] = Math.max(0, Math.min(255, Math.round(value * 255)))
  }
}

function applyGenericPolynomialPreset(imageData: PixelImageData, preset: PolynomialColorPreset) {
  const pixels = imageData.data
  const terms = new Float64Array(preset.exponents.length)

  for (let index = 0; index < pixels.length; index += 4) {
    const channels = [
      (pixels[index] ?? 0) / 255,
      (pixels[index + 1] ?? 0) / 255,
      (pixels[index + 2] ?? 0) / 255,
    ]

    preset.exponents.forEach((exponent, term) => {
      terms[term] = exponent.reduce(
        (value, power, channel) => value * (channels[channel] ?? 0) ** power,
        1,
      )
    })
    writeGenericPolynomialOutput(pixels, index, terms, preset.coefficients)
  }
}

export function applyColorPreset<T extends PixelImageData>(imageData: T, preset: ColorPreset): T {
  validateColorPresetShape(preset)
  if (preset.method === "identity") {
    return imageData
  }

  if (preset.method === "skimage-histogram-rgb-lut") {
    const { r, g, b } = preset.channels
    if (r.length !== 256 || g.length !== 256 || b.length !== 256) {
      throw new RangeError("Each preset channel must contain 256 entries.")
    }

    for (let index = 0; index < imageData.data.length; index += 4) {
      imageData.data[index] = r[imageData.data[index] ?? 0] ?? 0
      imageData.data[index + 1] = g[imageData.data[index + 1] ?? 0] ?? 0
      imageData.data[index + 2] = b[imageData.data[index + 2] ?? 0] ?? 0
    }
    return imageData
  }

  const applyPolynomial = hasCanonicalBasis(preset.exponents)
    ? applyCanonicalPolynomialPreset
    : applyGenericPolynomialPreset
  applyPolynomial(imageData, preset)
  return imageData
}

type TextureSource = CanvasImageSource & {
  complete?: boolean
  height: number
  naturalHeight?: number
  naturalWidth?: number
  width: number
}

const MIN_GPU_GRADING_PIXELS = 65_536

function isDrawable(source: TextureSource) {
  return source.complete !== false && Boolean(source.naturalWidth ?? source.width)
}

export class TextureCache {
  static readonly DEFAULT_MAX_ENTRIES = 32

  readonly #textures = new Map<string, TextureSource>()
  readonly #maxEntries: number
  readonly source: TextureSource

  constructor(source: TextureSource, maxEntries = TextureCache.DEFAULT_MAX_ENTRIES) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError("Texture cache maxEntries must be a positive integer.")
    }
    this.source = source
    this.#maxEntries = maxEntries
  }

  clear() {
    this.#textures.clear()
  }

  get(presetKey: string, preset?: ColorPreset, sourceRect?: SourceRectangle) {
    if (!isDrawable(this.source) || (presetKey && !preset)) {
      return null
    }
    if (!presetKey && !sourceRect) {
      return this.source
    }

    const region = sourceRect ?? {
      x: 0,
      y: 0,
      width: this.source.naturalWidth ?? this.source.width,
      height: this.source.naturalHeight ?? this.source.height,
    }
    const cacheKey = [
      presetKey || "identity",
      region.x,
      region.y,
      region.width,
      region.height,
    ].join(":")
    const cached = this.#textures.get(cacheKey)
    if (cached) {
      this.#textures.delete(cacheKey)
      this.#textures.set(cacheKey, cached)
      return cached
    }

    if (
      preset?.method === "rgb-polynomial" &&
      region.width * region.height >= MIN_GPU_GRADING_PIXELS &&
      hasCanonicalBasis(preset.exponents)
    ) {
      validateColorPresetShape(preset)
      const accelerated = tryGpuPolynomialGrading(this.source, region, preset)
      if (accelerated) {
        this.#set(cacheKey, accelerated)
        return accelerated
      }
    }

    const canvas = document.createElement("canvas")
    canvas.width = region.width
    canvas.height = region.height
    const context = canvas.getContext("2d", { willReadFrequently: true })
    if (!context) {
      throw new Error("A 2D canvas context is required.")
    }

    context.drawImage(
      this.source,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      region.width,
      region.height,
    )
    if (preset) {
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
      applyColorPreset(imageData, preset)
      context.putImageData(imageData, 0, 0)
    }
    this.#set(cacheKey, canvas)
    return canvas
  }

  #set(key: string, texture: TextureSource) {
    this.#textures.set(key, texture)
    if (this.#textures.size > this.#maxEntries) {
      const oldest = this.#textures.keys().next().value
      if (oldest !== undefined) {
        this.#textures.delete(oldest)
      }
    }
  }
}
