import { describe, expect, it } from "vitest"

import { createZipBlob } from "./zip"

describe("ZIP export", () => {
  it("writes stored UTF-8 files and a complete central directory", async () => {
    const archive = await createZipBlob([
      { data: "alpha", name: "one.txt" },
      { data: new Uint8Array([1, 2, 3]), name: "masks/two.bin" },
    ])
    const bytes = new Uint8Array(await archive.arrayBuffer())
    const view = new DataView(bytes.buffer)
    const text = new TextDecoder().decode(bytes)

    expect(archive.type).toBe("application/zip")
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50)
    expect(view.getUint16(bytes.length - 14, true)).toBe(2)
    expect(text).toContain("one.txt")
    expect(text).toContain("masks/two.bin")
  })
})
