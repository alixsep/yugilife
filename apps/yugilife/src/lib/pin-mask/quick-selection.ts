import type { PinMaskPoint } from "./quick-selection-types"

export type { PinMaskPoint } from "./quick-selection-types"

const maximumPresetDimension = 65_535
const maximumPresetPoints = 100_000

/** Decodes the compact PMB2 preset emitted by the local pymasker pipeline. */
export function decodePinMaskPreset(source: Uint8Array): readonly PinMaskPoint[] {
  let offset = 0
  const readByte = () => {
    const value = source[offset++]
    if (value === undefined) throw new Error("Pin mask preset ended unexpectedly.")
    return value
  }
  const readVarint = () => {
    let value = 0
    let shift = 0
    while (offset < source.length) {
      const byte = readByte()
      value += (byte & 0x7f) * 2 ** shift
      if (!Number.isSafeInteger(value)) throw new Error("Pin mask preset integer is too large.")
      if (!(byte & 0x80)) return value
      shift += 7
      if (shift > 49) throw new Error("Pin mask preset contains an oversized integer.")
    }
    throw new Error("Pin mask preset contains a truncated integer.")
  }
  if (source.length < 4 || new TextDecoder().decode(source.slice(0, 4)) !== "PMB2") {
    throw new Error("Pin mask preset format is unsupported.")
  }
  offset = 4
  const width = readVarint()
  const height = readVarint()
  const defaultCode = readByte()
  const positiveBits = readVarint()
  const negativeBits = readVarint()
  const positiveOverrides = readVarint()
  const negativeOverrides = readVarint()
  if (
    width < 1 ||
    height < 1 ||
    width > maximumPresetDimension ||
    height > maximumPresetDimension
  ) {
    throw new Error("Pin mask preset dimensions are invalid.")
  }
  if (defaultCode > 248) throw new Error("Pin mask preset default diameter is invalid.")
  const positiveBytes = Math.ceil(positiveBits / 8)
  const negativeBytes = Math.ceil(negativeBits / 8)
  if (
    !Number.isSafeInteger(positiveBytes + negativeBytes) ||
    positiveBytes + negativeBytes > source.length - offset
  ) {
    throw new Error("Pin mask coordinate data is truncated.")
  }
  const xBits = Math.max(1, (width - 1).toString(2).length)
  let nextId = 0
  const readCoordinates = (bitLength: number, polarity: PinMaskPoint["polarity"]) => {
    const start = offset
    const bytes = Math.ceil(bitLength / 8)
    let bitOffset = 0
    let y = 0
    const points: PinMaskPoint[] = []
    const readBits = (count: number) => {
      if (bitOffset + count > bitLength) throw new Error("Pin mask coordinate is truncated.")
      let value = 0
      for (let index = 0; index < count; index += 1) {
        const bit = bitOffset++
        value = value * 2 + ((source[start + (bit >> 3)]! >> (7 - (bit & 7))) & 1)
      }
      return value
    }
    const readGamma = () => {
      let zeroes = 0
      while (readBits(1) === 0) {
        zeroes += 1
        if (zeroes > 52) throw new Error("Pin mask coordinate is too large.")
      }
      return 2 ** zeroes + readBits(zeroes)
    }
    while (bitOffset < bitLength) {
      const x = readBits(xBits)
      y += readGamma() - 1
      if (x >= width || y >= height) throw new Error("Pin mask coordinate is out of bounds.")
      points.push({ id: ++nextId, polarity, size: (defaultCode + 8) / 2, x, y })
      if (nextId > maximumPresetPoints) throw new Error("Pin mask preset has too many points.")
    }
    offset = start + bytes
    return points
  }
  const positive = readCoordinates(positiveBits, "keep")
  const negative = readCoordinates(negativeBits, "remove")
  const applyOverrides = (points: PinMaskPoint[], count: number) => {
    if (count > points.length) throw new Error("Pin mask diameter override count is invalid.")
    let previous = -1
    for (let index = 0; index < count; index += 1) {
      const pointIndex = previous + readVarint() + 1
      const point = points[pointIndex]
      const code = readByte()
      if (!point || code > 248) throw new Error("Pin mask diameter override is invalid.")
      point.size = (code + 8) / 2
      previous = pointIndex
    }
  }
  applyOverrides(positive, positiveOverrides)
  applyOverrides(negative, negativeOverrides)
  if (offset !== source.length) throw new Error("Pin mask preset has trailing data.")
  return [...positive, ...negative]
}

// Internal tooling compatibility; production UI uses the worker client.
export { QuickSelection } from "./quick-selection-engine"
