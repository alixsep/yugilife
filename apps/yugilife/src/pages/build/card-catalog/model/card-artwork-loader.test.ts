import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { decodeYlm } from "@/lib/ylm"

import { loadCardArtwork, loadCardArtworks } from "./card-artwork-loader"

import type { CardArtworksLoadProgress } from "./card-artwork-loader"

vi.mock("@/lib/ylm", () => ({ decodeYlm: vi.fn() }))

const identity = {
  artworkId: 4766,
  cardCid: 4766,
  name: "Dark Magician Girl",
  passcode: "38033121",
}

const validMaskPreset = Uint8Array.from([
  ...new TextEncoder().encode("PMB2"),
  8,
  8,
  40,
  8,
  0,
  0,
  0,
  0x44,
])

function decoded(overrides: Record<string, unknown> = {}) {
  return {
    assets: new Map([["rgb", new TextEncoder().encode("avif")]]),
    bundleKind: "artwork",
    copyrightNotice: "fixture",
    identity: {
      artworkId: "4766",
      cardCid: "4766",
      name: "Dark Magician Girl",
      passcode: "38033121",
      relationship: "primary",
    },
    ...overrides,
  }
}

describe("card artwork loader", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(decodeYlm).mockResolvedValue(decoded() as Awaited<ReturnType<typeof decodeYlm>>)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("downloads, verifies, and returns only the RGB AVIF", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(Uint8Array.from([1, 2, 3, 4]), {
        headers: { "content-length": "4", "content-type": "application/octet-stream" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const progress = vi.fn()

    const artwork = await loadCardArtwork(identity, { onProgress: progress })

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://yugilife-artworks.alixsep.workers.dev/4766.ylm"),
      expect.objectContaining({ credentials: "omit", mode: "cors" }),
    )
    expect(decodeYlm).toHaveBeenCalledOnce()
    expect(artwork.type).toBe("image/avif")
    expect(await artwork.text()).toBe("avif")
    expect(progress).toHaveBeenCalledWith({
      loadedBytes: 4,
      phase: "downloading",
      totalBytes: 4,
    })
    expect(progress).toHaveBeenLastCalledWith({ phase: "verifying" })
  })

  it("starts at zero bytes and then reports no more than once every 250ms", async () => {
    vi.useFakeTimers()
    const chunkCount = 10
    const chunkBytes = 100
    let sent = 0
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              // Each chunk costs 100ms of wall clock, so a 250ms limit admits every third one.
              vi.advanceTimersByTime(100)
              controller.enqueue(new Uint8Array(chunkBytes).fill(1))
              sent += 1
              if (sent === chunkCount) controller.close()
            },
          }),
          { headers: { "content-length": String(chunkCount * chunkBytes) } },
        ),
      ),
    )
    const progress = vi.fn()

    await loadCardArtwork(identity, { onProgress: progress })

    const downloads = progress.mock.calls
      .map(([report]) => report as { loadedBytes: number; phase: string; totalBytes?: number })
      .filter((report) => report.phase === "downloading")
    // A forced zero, a report every 250ms of transfer, and a forced final byte count.
    expect(downloads.map((report) => report.loadedBytes)).toEqual([0, 300, 600, 900, 1000])
    expect(downloads[0]?.totalBytes).toBe(chunkCount * chunkBytes)
  })

  it("keeps batch progress monotonic across both bundles of every artwork", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: URL) => {
        const artworkId = url.pathname.includes("23488") ? 23488 : 4766
        const alpha = url.pathname.includes("_alpha")
        return Promise.resolve(
          new Response(Uint8Array.of((artworkId === 23488 ? 2 : 1) + (alpha ? 2 : 0))),
        )
      }),
    )
    vi.mocked(decodeYlm).mockImplementation((source) => {
      const marker = new Uint8Array(source)[0] ?? 0
      const artworkId = marker % 2 === 0 ? "23488" : "4766"
      const alpha = marker > 2
      return Promise.resolve(
        decoded({
          assets: alpha
            ? new Map([
                ["alpha", new TextEncoder().encode(`alpha-${artworkId}`)],
                ["mask", validMaskPreset],
              ])
            : new Map([["rgb", new TextEncoder().encode(`avif-${artworkId}`)]]),
          bundleKind: alpha ? "alpha" : "artwork",
          identity: { ...decoded().identity, artworkId },
        }) as Awaited<ReturnType<typeof decodeYlm>>,
      )
    })
    const progress = vi.fn()

    await loadCardArtworks(
      {
        artworkIds: [4766, 23488],
        cardCid: 4766,
        name: "Dark Magician Girl",
        passcode: "38033121",
      },
      { onProgress: progress },
    )

    const reports = progress.mock.calls.map(([report]) => report as CardArtworksLoadProgress)
    expect(reports.length).toBeGreaterThan(0)
    // The second bundle of an artwork must extend the first rather than reset it.
    reports.forEach((report, index) => {
      const previous = reports[index - 1]
      if (!previous) return
      expect(report.ratio).toBeGreaterThanOrEqual(previous.ratio)
      expect(report.loadedBytes).toBeGreaterThanOrEqual(previous.loadedBytes)
    })
    expect(reports.at(-1)?.ratio).toBe(1)
  })

  it("returns every mapped artwork only after the complete batch verifies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: URL) => {
        const artworkId = url.pathname.includes("23488") ? 23488 : 4766
        const alpha = url.pathname.includes("_alpha")
        return Promise.resolve(
          new Response(Uint8Array.of((artworkId === 23488 ? 2 : 1) + (alpha ? 2 : 0))),
        )
      }),
    )
    vi.mocked(decodeYlm).mockImplementation((source) => {
      const marker = new Uint8Array(source)[0] ?? 0
      const artworkId = marker % 2 === 0 ? "23488" : "4766"
      const alpha = marker > 2
      return Promise.resolve(
        decoded({
          assets: alpha
            ? new Map([
                ["alpha", new TextEncoder().encode(`alpha-${artworkId}`)],
                ["mask", validMaskPreset],
              ])
            : new Map([["rgb", new TextEncoder().encode(`avif-${artworkId}`)]]),
          bundleKind: alpha ? "alpha" : "artwork",
          identity: {
            ...decoded().identity,
            artworkId,
            relationship: artworkId === "4766" ? "primary" : "alternate",
          },
        }) as Awaited<ReturnType<typeof decodeYlm>>,
      )
    })

    const artworks = await loadCardArtworks({
      artworkIds: [4766, 23488],
      cardCid: 4766,
      name: "Dark Magician Girl",
      passcode: "38033121",
    })

    expect([...artworks.artworks.keys()]).toEqual([4766, 23488])
    expect(artworks.missingArtworkIds).toEqual([])
    expect(await artworks.artworks.get(4766)?.image.text()).toBe("avif-4766")
    expect(await artworks.artworks.get(23488)?.image.text()).toBe("avif-23488")
    expect(await artworks.artworks.get(4766)?.alphaMask?.text()).toBe("alpha-4766")
    expect(artworks.artworks.get(4766)?.maskPoints).toEqual([
      { id: 1, polarity: "keep", size: 24, x: 2, y: 3 },
    ])
  })

  it("reports missing variants without discarding available artwork", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation((url: URL) =>
          Promise.resolve(
            url.pathname.includes("23488") || url.pathname.includes("_alpha")
              ? new Response(null, { status: 404 })
              : new Response(Uint8Array.of(1)),
          ),
        ),
    )

    const result = await loadCardArtworks({
      artworkIds: [4766, 23488],
      cardCid: 4766,
      name: "Dark Magician Girl",
      passcode: "38033121",
    })

    expect([...result.artworks.keys()]).toEqual([4766])
    expect(result.missingArtworkIds).toEqual([23488])
  })

  it("rejects duplicate IDs instead of silently replacing an artwork", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(loadCardArtworks({ ...identity, artworkIds: [4766, 4766] })).rejects.toThrow(
      "duplicate artwork IDs",
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects a missing hosted artwork with a useful message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })))

    await expect(loadCardArtwork(identity)).rejects.toThrow("has not been uploaded yet")
    expect(decodeYlm).not.toHaveBeenCalled()
  })

  it("rejects truncated downloads before attempting to decode them", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(Uint8Array.from([1, 2, 3]), { headers: { "content-length": "4" } }),
        ),
    )

    await expect(loadCardArtwork(identity)).rejects.toThrow("ended before its declared size")
    expect(decodeYlm).not.toHaveBeenCalled()
  })

  it("rejects a valid YLM belonging to another artwork", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(Uint8Array.from([1]))))
    vi.mocked(decodeYlm).mockResolvedValue(
      decoded({ identity: { ...decoded().identity, artworkId: "23488" } }) as Awaited<
        ReturnType<typeof decodeYlm>
      >,
    )

    await expect(loadCardArtwork(identity)).rejects.toThrow("does not match the selected artwork")
  })

  it("explains likely network or CORS failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))

    await expect(loadCardArtwork(identity)).rejects.toThrow("connection and the server's CORS")
  })
})
