import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { fileURLToPath } from "node:url"

const wasmPath = fileURLToPath(
  new URL("../src/lib/pin-mask/quick-selection-kernels.wasm", import.meta.url),
)

async function loadKernel() {
  const bytes = await readFile(wasmPath)
  return (await WebAssembly.instantiate(bytes)).instance.exports
}

test("compact alpha kernels match the RGBA reference exactly across edges and glow settings", async () => {
  const exports = await loadKernel()
  let seed = 0x12345678
  for (const [width, height] of [
    [1, 1],
    [1, 17],
    [19, 1],
    [2, 2],
    [7, 11],
    [64, 57],
  ]) {
    const size = width * height
    for (const pattern of ["empty", "opaque", "binary", "partial"]) {
      exports.reset_heap()
      const rgbaPointer = exports.alloc(size * 4)
      const sourcePointer = exports.alloc(size)
      const smoothPointer = exports.alloc(size)
      const outputPointer = exports.alloc(size)
      const source = Uint8Array.from({ length: size }, () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        if (pattern === "empty") return 0
        if (pattern === "opaque") return 255
        return pattern === "binary" ? (seed >>> 24 > 127 ? 255 : 0) : seed >>> 24
      })
      new Uint8Array(exports.memory.buffer, sourcePointer, size).set(source)
      assert.equal(exports.mask_alpha_smooth(sourcePointer, smoothPointer, width, height), 1)
      const cachedSmooth = new Uint8Array(exports.memory.buffer, smoothPointer, size).slice()
      for (const antiAlias of [0, 1]) {
        for (const glow of [0, 1, 2, 3, 8, 16, 32, 64, 127, 128]) {
          const rgba = new Uint8Array(exports.memory.buffer, rgbaPointer, size * 4)
          rgba.fill(255)
          for (let index = 0; index < size; index++) rgba[index * 4 + 3] = source[index]
          new Uint8Array(exports.memory.buffer, outputPointer, size).set(
            antiAlias ? cachedSmooth : source,
          )
          assert.equal(exports.mask_effects_apply(rgbaPointer, width, height, antiAlias, glow), 1)
          assert.equal(exports.mask_alpha_glow(outputPointer, width, height, glow), 1)
          const expected = new Uint8Array(exports.memory.buffer, rgbaPointer, size * 4)
          const actual = new Uint8Array(exports.memory.buffer, outputPointer, size)
          for (let index = 0; index < size; index++) {
            assert.equal(
              actual[index],
              expected[index * 4 + 3],
              `${width}x${height} ${pattern} AA=${antiAlias} glow=${glow} pixel=${index}`,
            )
          }
          assert.deepEqual(new Uint8Array(exports.memory.buffer, sourcePointer, size), source)
          assert.deepEqual(new Uint8Array(exports.memory.buffer, smoothPointer, size), cachedSmooth)
        }
      }
    }
  }
})

test("checked-in pin-mask WASM exposes and executes the app mask-effects kernel", async () => {
  const exports = await loadKernel()
  assert.equal(typeof exports.mask_effects_apply, "function")

  exports.reset_heap()
  const pointer = exports.alloc(3 * 3 * 4)
  const pixels = new Uint8Array(exports.memory.buffer)
  for (let index = 0; index < 9; index += 1) {
    pixels[pointer + index * 4 + 3] = index === 4 ? 255 : 0
  }

  assert.equal(exports.mask_effects_apply(pointer, 3, 3, 0, 1), 1)
  const alpha = Array.from({ length: 9 }, (_, index) => pixels[pointer + index * 4 + 3])
  assert.equal(alpha[4], 255)
  assert.ok((alpha[0] ?? 0) > 0)
})

test("the 7x7 anti-alias pass softens three pixels around the edge while preserving interiors", async () => {
  const exports = await loadKernel()
  exports.reset_heap()
  const width = 31
  const height = 31
  const pointer = exports.alloc(width * height * 4)
  const pixels = new Uint8Array(exports.memory.buffer)
  for (let y = 8; y <= 24; y += 1) {
    for (let x = 12; x <= 24; x += 1) {
      pixels[pointer + (y * width + x) * 4 + 3] = 255
    }
  }

  assert.equal(exports.mask_effects_apply(pointer, width, height, 1, 0), 1)
  const alpha = (x, y) => pixels[pointer + (y * width + x) * 4 + 3]
  assert.equal(alpha(18, 18), 255)
  assert.equal(alpha(0, 0), 0)
  assert.deepEqual(
    [8, 9, 10, 11, 12].map((x) => alpha(x, 18)),
    [0, 36, 73, 109, 146],
  )
})

test("the WASM glow keeps the source edge opaque and fades outward monotonically", async () => {
  const exports = await loadKernel()
  exports.reset_heap()
  const width = 11
  const height = 13
  const pointer = exports.alloc(width * height * 4)
  const pixels = new Uint8Array(exports.memory.buffer)
  for (let y = 5; y < 8; y += 1) {
    for (let x = 4; x < 7; x += 1) {
      pixels[pointer + (y * width + x) * 4 + 3] = 255
    }
  }

  assert.equal(exports.mask_effects_apply(pointer, width, height, 0, 4), 1)
  const alpha = (x, y) => pixels[pointer + (y * width + x) * 4 + 3]
  assert.equal(alpha(5, 5), 255)
  assert.equal(alpha(5, 4), 204)
  assert.equal(alpha(5, 3), 153)
  assert.equal(alpha(5, 2), 102)
  assert.equal(alpha(5, 1), 51)
  assert.equal(alpha(5, 0), 0)
})

test("the WASM effect path accepts a native-size 2048px mask", async () => {
  const exports = await loadKernel()
  exports.reset_heap()
  const width = 2048
  const height = 2048
  const pointer = exports.alloc(width * height * 4)
  assert.ok(pointer)
  const pixels = new Uint8Array(exports.memory.buffer)
  pixels[pointer + 3] = 255
  assert.equal(exports.mask_effects_apply(pointer, width, height, 1, 0), 1)
  assert.equal(exports.mask_effects_apply(pointer, width, height, 0, 1), 1)
})

test("quick refinement restores its prepared baseline across dense repeated edits", async () => {
  const exports = await loadKernel()
  exports.reset_heap()
  const width = 768
  const height = 768
  const count = width * height
  const imagePointer = exports.alloc(count * 4)
  const hardPointer = exports.alloc(count)
  const outputPointer = exports.alloc(count)
  assert.ok(imagePointer && hardPointer && outputPointer)
  let memory = new Uint8Array(exports.memory.buffer)
  for (let index = 0; index < count; index += 1) {
    const offset = imagePointer + index * 4
    memory[offset] = index % width
    memory[offset + 1] = Math.floor(index / width)
    memory[offset + 2] = 128
    memory[offset + 3] = 255
  }
  assert.equal(exports.quick_prepare(imagePointer, width, height), 1)
  for (let iteration = 0; iteration < 4; iteration += 1) {
    memory = new Uint8Array(exports.memory.buffer)
    memory.fill(128, hardPointer, hardPointer + count)
    for (const offset of [0, width - 1, (height - 1) * width, count - 1])
      memory[hardPointer + offset] = 0
    for (let point = 0; point < 1_000; point += 1) {
      const centerX = (point * 37) % width
      const centerY = (point * 53) % height
      for (let y = Math.max(0, centerY - 12); y <= Math.min(height - 1, centerY + 12); y += 1) {
        for (let x = Math.max(0, centerX - 12); x <= Math.min(width - 1, centerX + 12); x += 1) {
          if (Math.hypot(x - centerX, y - centerY) <= 12) {
            memory[hardPointer + y * width + x] = point % 2 === 0 ? 255 : 0
          }
        }
      }
    }
    assert.equal(exports.quick_refine(hardPointer, outputPointer), 1)
    assert.equal(exports.quick_error(), 0)
  }
})
