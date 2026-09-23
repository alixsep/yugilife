import { describe, expect, it } from "vitest"

import { encodeQr, QR_QUIET_ZONE, qrPath, qrVersionFor } from "./qr-code"

import type { QrMatrix } from "./qr-code"

/**
 * A reader written separately from the encoder: its own module walk, its own format-info check,
 * its own field arithmetic. Agreement between the two is what makes a symbol here trustworthy,
 * since nothing in the unit environment can point a camera at one.
 */

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x
  LOG[x] = i
  x <<= 1
  if (x & 0x100) x ^= 0x11d
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!
const multiply = (a: number, b: number) => (a && b ? EXP[LOG[a]! + LOG[b]!]! : 0)

const ECC_PER_BLOCK: Record<number, number> = {
  1: 10,
  2: 16,
  3: 26,
  4: 18,
  5: 24,
  6: 16,
  7: 18,
  8: 22,
  9: 22,
  10: 26,
}
const BLOCKS: Record<number, number> = {
  1: 1,
  2: 1,
  3: 1,
  4: 2,
  5: 2,
  6: 4,
  7: 4,
  8: 4,
  9: 5,
  10: 5,
}
const TOTAL_CODEWORDS: Record<number, number> = {
  1: 26,
  2: 44,
  3: 70,
  4: 100,
  5: 134,
  6: 172,
  7: 196,
  8: 242,
  9: 292,
  10: 346,
}

function moduleAt({ modules, size }: QrMatrix, x: number, y: number) {
  return modules[y * size + x]!
}

/** Everything a reader must skip: finders and separators, timing, alignment, format, version. */
function reservedMap(size: number, version: number) {
  const reserved = new Uint8Array(size * size)
  const mark = (x: number, y: number) => {
    if (x >= 0 && x < size && y >= 0 && y < size) reserved[y * size + x] = 1
  }
  // Top-left: finder, separator and both format strips make a 9 x 9 block. The other two corners
  // hold finder and separator on one side only, plus a single format strip on the other.
  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 9; j++) {
      mark(i, j)
      if (i < 8) mark(size - 1 - i, j)
      if (j < 8) mark(i, size - 1 - j)
    }
  }
  for (let i = 0; i < size; i++) {
    mark(6, i)
    mark(i, 6)
  }
  if (version >= 2) {
    const count = Math.floor(version / 7) + 2
    const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2
    const centres = [6]
    for (let position = size - 7; centres.length < count; position -= step)
      centres.splice(1, 0, position)
    const last = centres.length - 1
    centres.forEach((cy, i) =>
      centres.forEach((cx, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(cx + dx, cy + dy)
      }),
    )
  }
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        mark(i, size - 11 + j)
        mark(size - 11 + j, i)
      }
    }
  }
  return reserved
}

/** The 15 format bits from the copy beside the top-left finder, checked against their BCH code. */
function readFormat(matrix: QrMatrix) {
  const { size } = matrix
  const bits: number[] = []
  for (let i = 0; i <= 5; i++) bits.push(moduleAt(matrix, 8, i))
  bits.push(moduleAt(matrix, 8, 7), moduleAt(matrix, 8, 8), moduleAt(matrix, 7, 8))
  for (let i = 9; i < 15; i++) bits.push(moduleAt(matrix, 14 - i, 8))
  let value = 0
  bits.forEach((bit, index) => (value |= bit << index))

  const second: number[] = []
  for (let i = 0; i < 8; i++) second.push(moduleAt(matrix, size - 1 - i, 8))
  for (let i = 8; i < 15; i++) second.push(moduleAt(matrix, 8, size - 15 + i))
  let secondValue = 0
  second.forEach((bit, index) => (secondValue |= bit << index))
  expect(secondValue).toBe(value)

  const unmasked = value ^ 0x5412
  let remainder = unmasked
  for (let i = 14; i >= 10; i--) if (remainder & (1 << i)) remainder ^= 0x537 << (i - 10)
  expect(remainder).toBe(0)
  return { level: (unmasked >> 13) & 0b11, mask: (unmasked >> 10) & 0b111 }
}

function maskBit(mask: number, x: number, y: number) {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0
    case 1:
      return y % 2 === 0
    case 2:
      return x % 3 === 0
    case 3:
      return (x + y) % 3 === 0
    case 4:
      return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
  }
}

/** Codeword order as a reader collects it: right-to-left column pairs, snaking up and down. */
function readCodewords(matrix: QrMatrix, mask: number, reserved: Uint8Array) {
  const { size } = matrix
  const bits: number[] = []
  let upward = true
  for (let column = size - 1; column > 0; column -= 2) {
    if (column === 6) column--
    const rows = [...Array(size).keys()]
    if (upward) rows.reverse()
    for (const y of rows) {
      for (const x of [column, column - 1]) {
        if (reserved[y * size + x]) continue
        bits.push(moduleAt(matrix, x, y) ^ (maskBit(mask, x, y) ? 1 : 0))
      }
    }
    upward = !upward
  }
  const codewords: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0))
  }
  return codewords
}

function deinterleave(codewords: number[], version: number) {
  const blocks = BLOCKS[version]!
  const ecc = ECC_PER_BLOCK[version]!
  const total = TOTAL_CODEWORDS[version]!
  const shortBlocks = blocks - (total % blocks)
  const shortData = Math.floor(total / blocks) - ecc
  const lengths = Array.from({ length: blocks }, (_, i) => shortData + (i < shortBlocks ? 0 : 1))
  const data: number[][] = lengths.map(() => [])
  const parity: number[][] = lengths.map(() => [])
  let cursor = 0
  for (let i = 0; i < shortData + 1; i++) {
    lengths.forEach((length, block) => {
      if (i < length) data[block]!.push(codewords[cursor++]!)
    })
  }
  for (let i = 0; i < ecc; i++) {
    for (let block = 0; block < blocks; block++) parity[block]!.push(codewords[cursor++]!)
  }
  return data.map((block, i) => [...block, ...parity[i]!])
}

/** Every syndrome of a valid Reed–Solomon codeword is zero. */
function syndromesAreZero(block: number[], ecc: number) {
  for (let i = 0; i < ecc; i++) {
    let sum = 0
    for (const byte of block) sum = multiply(sum, EXP[i]!) ^ byte
    if (sum !== 0) return false
  }
  return true
}

function decode(matrix: QrMatrix) {
  const version = (matrix.size - 17) / 4
  expect(Number.isInteger(version)).toBe(true)
  const { level, mask } = readFormat(matrix)
  expect(level).toBe(0b00)

  const reserved = reservedMap(matrix.size, version)
  const blocks = deinterleave(readCodewords(matrix, mask, reserved), version)
  for (const block of blocks) expect(syndromesAreZero(block, ECC_PER_BLOCK[version]!)).toBe(true)

  const data = blocks.flatMap((block) => block.slice(0, block.length - ECC_PER_BLOCK[version]!))
  const bits: number[] = []
  for (const byte of data) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1)
  const take = (count: number) => {
    let value = 0
    for (let i = 0; i < count; i++) value = (value << 1) | bits.shift()!
    return value
  }
  expect(take(4)).toBe(0b0100)
  const length = take(version < 10 ? 8 : 16)
  const bytes = Uint8Array.from({ length }, () => take(8))
  return new TextDecoder().decode(bytes)
}

function finderIsIntact(matrix: QrMatrix, cx: number, cy: number) {
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const ring = Math.max(Math.abs(dx), Math.abs(dy))
      if (moduleAt(matrix, cx + dx, cy + dy) !== (ring === 2 ? 0 : 1)) return false
    }
  }
  return true
}

describe("QR encoding", () => {
  const samples = [
    "https://t.me/yugilife",
    "https://discord.com/users/123456789012345678",
    "mailto:someone@example.com",
    "A".repeat(150),
    "ünïcödé — 日本語 🙂",
  ]

  it.each(samples)("reads back %s through an independent decoder", (text) => {
    expect(decode(encodeQr(text))).toBe(text)
  })

  it("chooses the smallest version that holds the text", () => {
    expect(encodeQr("").size).toBe(21)
    expect(encodeQr("A".repeat(14)).size).toBe(21)
    expect(encodeQr("A".repeat(15)).size).toBe(25)
    expect(encodeQr("A".repeat(150)).size).toBe(17 + 4 * 8)
  })

  it("keeps the three finder patterns whole under every mask", () => {
    for (const text of samples) {
      const matrix = encodeQr(text)
      const edge = matrix.size - 4
      expect(finderIsIntact(matrix, 3, 3)).toBe(true)
      expect(finderIsIntact(matrix, edge, 3)).toBe(true)
      expect(finderIsIntact(matrix, 3, edge)).toBe(true)
    }
  })

  it("draws one square per dark module inside the quiet zone", () => {
    const matrix = encodeQr("https://t.me/yugilife")
    const dark = matrix.modules.reduce((total, module) => total + module, 0)
    const path = qrPath(matrix)
    expect(path.match(/h1v1h-1z/g)).toHaveLength(dark)
    expect(path.startsWith(`M${QR_QUIET_ZONE} ${QR_QUIET_ZONE}`)).toBe(true)
  })

  it("encodes at a floor version so a set of codes shares one module size", () => {
    const texts = ["https://t.me/yugilife", "https://discord.com/users/123456789012345678"]
    const version = Math.max(...texts.map((text) => qrVersionFor(text)))
    const matrices = texts.map((text) => encodeQr(text, version))

    expect(new Set(matrices.map(({ size }) => size)).size).toBe(1)
    // Padded out, not merely resized: each still reads back as itself.
    matrices.forEach((matrix, index) => expect(decode(matrix)).toBe(texts[index]))
  })

  it("refuses text beyond version 40", () => {
    expect(() => encodeQr("A".repeat(3000))).toThrow("too long")
  })
})
