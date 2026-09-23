/**
 * A QR encoder for the donate sheet's contact links.
 *
 * Byte mode at error-correction level M, the version chosen as the smallest that fits. The sheet
 * encodes three short URLs, which is far too little to justify a dependency; this is the standard
 * construction (ISO/IEC 18004) written out, and `qr-code.test.ts` reads every symbol back through
 * an independent decoder so a placement or arithmetic slip cannot pass as a scannable code.
 */

export interface QrMatrix {
  readonly size: number
  /** Row-major, one entry per module; 1 is dark. */
  readonly modules: Uint8Array
}

const MIN_VERSION = 1
const MAX_VERSION = 40

/** Error-correction level M: the format-info bits and the block structure per version. */
const LEVEL_M_FORMAT_BITS = 0
const ECC_CODEWORDS_PER_BLOCK = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
]
const ERROR_CORRECTION_BLOCKS = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25,
  26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
]

const PENALTY_N1 = 3
const PENALTY_N2 = 3
const PENALTY_N3 = 40
const PENALTY_N4 = 10

/** Carry-less multiplication in GF(2^8) modulo x^8 + x^4 + x^3 + x^2 + 1. */
function multiply(x: number, y: number) {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}

/** The Reed–Solomon generator polynomial of the given degree, highest-order term omitted. */
function reedSolomonDivisor(degree: number) {
  const result = new Array<number>(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = multiply(result[j]!, root)
      if (j + 1 < result.length) result[j]! ^= result[j + 1]!
    }
    root = multiply(root, 0x02)
  }
  return result
}

function reedSolomonRemainder(data: readonly number[], divisor: readonly number[]) {
  const result = divisor.map(() => 0)
  for (const byte of data) {
    const factor = byte ^ result.shift()!
    result.push(0)
    divisor.forEach((coefficient, index) => {
      result[index]! ^= multiply(coefficient, factor)
    })
  }
  return result
}

function rawDataModules(version: number) {
  let result = (16 * version + 128) * version + 64
  if (version >= 2) {
    const alignments = Math.floor(version / 7) + 2
    result -= (25 * alignments - 10) * alignments - 55
    if (version >= 7) result -= 36
  }
  return result
}

function dataCodewords(version: number) {
  return (
    Math.floor(rawDataModules(version) / 8) -
    ECC_CODEWORDS_PER_BLOCK[version]! * ERROR_CORRECTION_BLOCKS[version]!
  )
}

function alignmentPositions(version: number) {
  if (version === 1) return []
  const count = Math.floor(version / 7) + 2
  const size = version * 4 + 17
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2
  const result = [6]
  for (let position = size - 7; result.length < count; position -= step) {
    result.splice(1, 0, position)
  }
  return result
}

function bitOf(value: number, index: number) {
  return ((value >>> index) & 1) as 0 | 1
}

class QrSymbol {
  readonly version: number
  readonly size: number
  readonly modules: Uint8Array
  private readonly reserved: Uint8Array

  constructor(version: number) {
    this.version = version
    this.size = version * 4 + 17
    this.modules = new Uint8Array(this.size * this.size)
    this.reserved = new Uint8Array(this.size * this.size)
  }

  get(x: number, y: number) {
    return this.modules[y * this.size + x]!
  }

  private setFunction(x: number, y: number, dark: boolean) {
    this.modules[y * this.size + x] = dark ? 1 : 0
    this.reserved[y * this.size + x] = 1
  }

  isReserved(x: number, y: number) {
    return this.reserved[y * this.size + x] === 1
  }

  drawFunctionPatterns() {
    for (let i = 0; i < this.size; i++) {
      this.setFunction(6, i, i % 2 === 0)
      this.setFunction(i, 6, i % 2 === 0)
    }
    this.drawFinder(3, 3)
    this.drawFinder(this.size - 4, 3)
    this.drawFinder(3, this.size - 4)

    const positions = alignmentPositions(this.version)
    const last = positions.length - 1
    positions.forEach((y, i) => {
      positions.forEach((x, j) => {
        const cornerOfFinder =
          (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)
        if (!cornerOfFinder) this.drawAlignment(x, y)
      })
    })

    this.drawFormatBits(0)
    this.drawVersion()
  }

  private drawFinder(x: number, y: number) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy))
        const xx = x + dx
        const yy = y + dy
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
          this.setFunction(xx, yy, distance !== 2 && distance !== 4)
        }
      }
    }
  }

  private drawAlignment(x: number, y: number) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunction(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
      }
    }
  }

  drawFormatBits(mask: number) {
    const data = (LEVEL_M_FORMAT_BITS << 3) | mask
    let remainder = data
    for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537)
    const bits = ((data << 10) | remainder) ^ 0x5412

    for (let i = 0; i <= 5; i++) this.setFunction(8, i, bitOf(bits, i) === 1)
    this.setFunction(8, 7, bitOf(bits, 6) === 1)
    this.setFunction(8, 8, bitOf(bits, 7) === 1)
    this.setFunction(7, 8, bitOf(bits, 8) === 1)
    for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, bitOf(bits, i) === 1)

    for (let i = 0; i < 8; i++) this.setFunction(this.size - 1 - i, 8, bitOf(bits, i) === 1)
    for (let i = 8; i < 15; i++) this.setFunction(8, this.size - 15 + i, bitOf(bits, i) === 1)
    this.setFunction(8, this.size - 8, true)
  }

  private drawVersion() {
    if (this.version < 7) return
    let remainder = this.version
    for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25)
    const bits = (this.version << 12) | remainder
    for (let i = 0; i < 18; i++) {
      const dark = bitOf(bits, i) === 1
      const a = this.size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      this.setFunction(a, b, dark)
      this.setFunction(b, a, dark)
    }
  }

  /** Codewords into the free modules, two columns at a time, bottom-up then top-down. */
  drawCodewords(codewords: readonly number[]) {
    let bit = 0
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5
      for (let vertical = 0; vertical < this.size; vertical++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j
          const upward = ((right + 1) & 2) === 0
          const y = upward ? this.size - 1 - vertical : vertical
          if (!this.isReserved(x, y) && bit < codewords.length * 8) {
            this.modules[y * this.size + x] = bitOf(codewords[bit >>> 3]!, 7 - (bit & 7))
            bit++
          }
        }
      }
    }
  }

  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.isReserved(x, y)) continue
        let invert: boolean
        switch (mask) {
          case 0:
            invert = (x + y) % 2 === 0
            break
          case 1:
            invert = y % 2 === 0
            break
          case 2:
            invert = x % 3 === 0
            break
          case 3:
            invert = (x + y) % 3 === 0
            break
          case 4:
            invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
            break
          case 5:
            invert = ((x * y) % 2) + ((x * y) % 3) === 0
            break
          case 6:
            invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
            break
          default:
            invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
        }
        if (!invert) continue
        const index = y * this.size + x
        this.modules[index] = this.modules[index]! ^ 1
      }
    }
  }

  penaltyScore() {
    let result = 0
    const size = this.size

    for (let y = 0; y < size; y++) {
      let runColor = 0
      let runX = 0
      const history = new Array<number>(7).fill(0)
      for (let x = 0; x < size; x++) {
        if (this.get(x, y) === runColor) {
          runX++
          if (runX === 5) result += PENALTY_N1
          else if (runX > 5) result++
        } else {
          this.finderPenaltyAddHistory(runX, history)
          if (runColor === 0) result += this.finderPenaltyCountPatterns(history) * PENALTY_N3
          runColor = this.get(x, y)
          runX = 1
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runX, history) * PENALTY_N3
    }

    for (let x = 0; x < size; x++) {
      let runColor = 0
      let runY = 0
      const history = new Array<number>(7).fill(0)
      for (let y = 0; y < size; y++) {
        if (this.get(x, y) === runColor) {
          runY++
          if (runY === 5) result += PENALTY_N1
          else if (runY > 5) result++
        } else {
          this.finderPenaltyAddHistory(runY, history)
          if (runColor === 0) result += this.finderPenaltyCountPatterns(history) * PENALTY_N3
          runColor = this.get(x, y)
          runY = 1
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runY, history) * PENALTY_N3
    }

    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const color = this.get(x, y)
        if (
          color === this.get(x + 1, y) &&
          color === this.get(x, y + 1) &&
          color === this.get(x + 1, y + 1)
        ) {
          result += PENALTY_N2
        }
      }
    }

    let dark = 0
    for (const module of this.modules) dark += module
    const total = size * size
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1
    result += k * PENALTY_N4
    return result
  }

  private finderPenaltyCountPatterns(history: readonly number[]) {
    const n = history[1]!
    const core =
      n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n
    return (
      (core && history[0]! >= n * 4 && history[6]! >= n ? 1 : 0) +
      (core && history[6]! >= n * 4 && history[0]! >= n ? 1 : 0)
    )
  }

  private finderPenaltyTerminateAndCount(
    currentRunColor: number,
    currentRunLength: number,
    history: number[],
  ) {
    let length = currentRunLength
    if (currentRunColor === 1) {
      this.finderPenaltyAddHistory(length, history)
      length = 0
    }
    length += this.size
    this.finderPenaltyAddHistory(length, history)
    return this.finderPenaltyCountPatterns(history)
  }

  private finderPenaltyAddHistory(currentRunLength: number, history: number[]) {
    let length = currentRunLength
    if (history[0]! === 0) length += this.size
    history.pop()
    history.unshift(length)
  }
}

function chooseVersion(byteLength: number, minVersion = MIN_VERSION) {
  for (let version = Math.max(MIN_VERSION, minVersion); version <= MAX_VERSION; version++) {
    const countBits = version < 10 ? 8 : 16
    const needed = 4 + countBits + byteLength * 8
    if (needed <= dataCodewords(version) * 8) return version
  }
  throw new Error("The text is too long for a QR code.")
}

function encodeCodewords(bytes: Uint8Array, version: number) {
  const bits: number[] = []
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push(bitOf(value, i))
  }
  push(0b0100, 4)
  push(bytes.length, version < 10 ? 8 : 16)
  for (const byte of bytes) push(byte, 8)

  const capacity = dataCodewords(version) * 8
  push(0, Math.min(4, capacity - bits.length))
  push(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8)

  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]!
    data.push(byte)
  }
  return data
}

function addErrorCorrection(data: readonly number[], version: number) {
  const blocks = ERROR_CORRECTION_BLOCKS[version]!
  const eccLength = ECC_CODEWORDS_PER_BLOCK[version]!
  const rawCodewords = Math.floor(rawDataModules(version) / 8)
  const shortBlocks = blocks - (rawCodewords % blocks)
  const shortBlockLength = Math.floor(rawCodewords / blocks)

  const divisor = reedSolomonDivisor(eccLength)
  const encoded: number[][] = []
  let offset = 0
  for (let i = 0; i < blocks; i++) {
    const length = shortBlockLength - eccLength + (i < shortBlocks ? 0 : 1)
    const block = data.slice(offset, offset + length)
    offset += length
    const ecc = reedSolomonRemainder(block, divisor)
    if (i < shortBlocks) block.push(0)
    encoded.push(block.concat(ecc))
  }

  const result: number[] = []
  for (let i = 0; i < encoded[0]!.length; i++) {
    encoded.forEach((block, j) => {
      if (i !== shortBlockLength - eccLength || j >= shortBlocks) result.push(block[i]!)
    })
  }
  return result
}

/**
 * `minVersion` draws the symbol larger than it needs to be. A set of codes shown side by side
 * reads as one family only if their modules are the same size, and version is what decides that:
 * left alone, a longer URL silently becomes a denser square beside its neighbours.
 */
export function encodeQr(text: string, minVersion = MIN_VERSION): QrMatrix {
  const bytes = new TextEncoder().encode(text)
  const version = chooseVersion(bytes.length, minVersion)
  const symbol = new QrSymbol(version)
  symbol.drawFunctionPatterns()
  symbol.drawCodewords(addErrorCorrection(encodeCodewords(bytes, version), version))

  let bestMask = 0
  let bestPenalty = Number.POSITIVE_INFINITY
  for (let mask = 0; mask < 8; mask++) {
    symbol.applyMask(mask)
    symbol.drawFormatBits(mask)
    const penalty = symbol.penaltyScore()
    if (penalty < bestPenalty) {
      bestPenalty = penalty
      bestMask = mask
    }
    symbol.applyMask(mask)
  }
  symbol.applyMask(bestMask)
  symbol.drawFormatBits(bestMask)

  return { modules: symbol.modules, size: symbol.size }
}

/** The smallest version that holds `text`, without building the symbol. */
export function qrVersionFor(text: string) {
  return chooseVersion(new TextEncoder().encode(text).length)
}

export const QR_QUIET_ZONE = 4

/** One path covering every dark module, offset by the quiet zone, for a viewBox of `size + 8`. */
export function qrPath({ modules, size }: QrMatrix) {
  const parts: string[] = []
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y * size + x]) parts.push(`M${x + QR_QUIET_ZONE} ${y + QR_QUIET_ZONE}h1v1h-1z`)
    }
  }
  return parts.join("")
}
