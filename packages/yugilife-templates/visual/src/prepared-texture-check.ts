import {
  applyColorPreset,
  collectTexturePreparations,
  preparedTextureKey,
} from "yugilife-core/color-grading"

import { DEFAULT_TEMPLATE } from "../../src/index"

import type { PreparedTextures, TexturePreparation } from "yugilife-core"

export interface PreparedTextureCheck {
  checked: number
  mismatches: string[]
}

function canvasContext(width: number, height: number) {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) throw new Error("A 2D canvas context is required.")
  return context
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.addEventListener("load", () => resolve(image), { once: true })
    image.addEventListener("error", () => reject(new Error(`Could not load "${source}".`)), {
      once: true,
    })
    image.src = source
  })
}

async function gradedPixels(preparation: TexturePreparation) {
  const source = DEFAULT_TEMPLATE.assets[preparation.assetId]
  if (typeof source !== "string") {
    throw new Error(`Texture asset "${preparation.assetId}" is not a fetchable URL.`)
  }
  const image = await loadImage(source)
  const region = preparation.region ?? {
    x: 0,
    y: 0,
    width: image.naturalWidth,
    height: image.naturalHeight,
  }
  const context = canvasContext(region.width, region.height)
  context.drawImage(
    image,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    region.width,
    region.height,
  )
  const pixels = context.getImageData(0, 0, region.width, region.height)
  const preset = DEFAULT_TEMPLATE.colorPresets[preparation.presetName]
  if (!preset) throw new Error(`Unknown color preset "${preparation.presetName}".`)
  applyColorPreset(pixels, preset)
  return pixels
}

/**
 * Compares every prepared texture against grading the same region here and now.
 *
 * Both sides are read back from a canvas that received the pixels the same way, so the comparison
 * isolates the one thing storing a texture could damage: whether the separated, losslessly encoded
 * planes restore the exact bytes that grading produced. The screenshots cannot make that claim on
 * their own — a texture drawn behind other layers can be wrong where nothing shows it.
 */
export async function verifyPreparedTextures(
  textures: PreparedTextures,
): Promise<PreparedTextureCheck> {
  const preparations = collectTexturePreparations(
    DEFAULT_TEMPLATE.template,
    DEFAULT_TEMPLATE.colorPresets,
  )
  const mismatches: string[] = []

  for (const preparation of preparations) {
    const key = preparedTextureKey(preparation)
    const prepared = await textures.get(key)
    if (!prepared) {
      mismatches.push(`${key}: no prepared texture`)
      continue
    }
    const expectedPixels = await gradedPixels(preparation)
    const { width, height } = expectedPixels

    const expectedContext = canvasContext(width, height)
    expectedContext.putImageData(expectedPixels, 0, 0)
    const expected = expectedContext.getImageData(0, 0, width, height).data

    const actualContext = canvasContext(width, height)
    actualContext.drawImage(prepared, 0, 0)
    const actual = actualContext.getImageData(0, 0, width, height).data

    let differing = 0
    for (let index = 0; index < expected.length; index += 1) {
      if (expected[index] !== actual[index]) differing += 1
    }
    if (differing > 0) {
      mismatches.push(`${key}: ${differing} differing channel values of ${expected.length}`)
    }
  }

  return { checked: preparations.length, mismatches }
}
