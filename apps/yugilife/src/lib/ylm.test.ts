import { createCipheriv, createHash } from "node:crypto"

import { describe, expect, it } from "vitest"

import { decodeYlm, ylmCopyrightNotice } from "./ylm"

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

function fixture(passcode: string | null = "38033121") {
  const key = createHash("sha256").update("yugilife").digest()
  const nonce = Uint8Array.from({ length: 12 }, (_, index) => index + 32)
  const values = [new TextEncoder().encode("rgb")]
  let byteOffset = 0
  const assets = values.map((bytes, index) => {
    const descriptor = {
      byteLength: bytes.length,
      byteOffset,
      kind: ["rgb", "alpha", "mask"][index],
      mediaType: index < 2 ? "image/avif" : "application/vnd.yugilife.mask-dots",
      sha256: sha256(bytes),
    }
    byteOffset += bytes.length
    return descriptor
  })
  const header = Buffer.from(
    JSON.stringify({
      assets,
      bundleKind: "artwork",
      copyrightNotice: ylmCopyrightNotice,
      encryption: { algorithm: "AES-256-GCM", derivation: "SHA-256", openerId: "fixture" },
      format: "yugilife/media",
      identity: {
        artworkId: "4766",
        cardCid: "4766",
        name: "Dark Magician Girl",
        passcode,
        relationship: "primary",
      },
      schemaVersion: 1,
    }),
  )
  const magic = Buffer.from("YLMEDIA1")
  const headerLength = Buffer.alloc(4)
  headerLength.writeUInt32BE(header.length)
  const authenticatedData = Buffer.concat([magic, headerLength, nonce, header])
  const cipher = createCipheriv("aes-256-gcm", key, nonce)
  cipher.setAAD(authenticatedData)
  const encrypted = Buffer.concat([cipher.update(Buffer.concat(values)), cipher.final()])
  return {
    encoded: Buffer.concat([magic, headerLength, nonce, cipher.getAuthTag(), header, encrypted]),
  }
}

describe("YLM decoder", () => {
  it("authenticates and decodes all assets in memory", async () => {
    const { encoded } = fixture()
    const decoded = await decodeYlm(
      encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength),
    )
    expect(decoded.identity).toMatchObject({
      artworkId: "4766",
      cardCid: "4766",
      passcode: "38033121",
    })
    expect(decoded.bundleKind).toBe("artwork")
    expect(
      [...decoded.assets].map(([kind, bytes]) => [kind, new TextDecoder().decode(bytes)]),
    ).toEqual([["rgb", "rgb"]])
  })

  it("rejects tampering", async () => {
    const { encoded } = fixture()
    const tampered = Buffer.from(encoded)
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1
    await expect(
      decodeYlm(
        tampered.buffer.slice(tampered.byteOffset, tampered.byteOffset + tampered.byteLength),
      ),
    ).rejects.toThrow(/authentication/)
  })

  it("accepts an official card identity without a passcode", async () => {
    const { encoded } = fixture(null)
    const decoded = await decodeYlm(
      encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength),
    )

    expect(decoded.identity.passcode).toBeNull()
  })
})
