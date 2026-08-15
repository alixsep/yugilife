import { afterEach, describe, expect, it, vi } from "vitest"

import { loadDrawable } from "../src/rendering/assets"

const originalImage = globalThis.Image

afterEach(() => {
  vi.restoreAllMocks()
  globalThis.Image = originalImage
})

describe("render asset reuse", () => {
  it("shares one in-flight image load between renders", async () => {
    let instances = 0
    class FakeImage {
      height = 150
      width = 100
      #load?: () => void

      constructor() {
        instances += 1
      }

      addEventListener(type: string, listener: () => void) {
        if (type === "load") this.#load = listener
      }

      set src(_value: string) {
        queueMicrotask(() => this.#load?.())
      }
    }
    globalThis.Image = FakeImage as unknown as typeof Image

    const [first, second] = await Promise.all([
      loadDrawable("/shared-test-image.png"),
      loadDrawable("/shared-test-image.png"),
    ])

    expect(instances).toBe(1)
    expect(first).toBe(second)
  })

  it("lets an aborted consumer stop waiting without poisoning the shared load", async () => {
    let finishLoad: (() => void) | undefined
    class FakeImage {
      height = 150
      width = 100

      addEventListener(type: string, listener: () => void) {
        if (type === "load") finishLoad = listener
      }

      set src(_value: string) {}
    }
    globalThis.Image = FakeImage as unknown as typeof Image
    const controller = new AbortController()
    const aborted = loadDrawable("/abort-test-image.png", controller.signal)
    const continuing = loadDrawable("/abort-test-image.png")

    controller.abort()
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" })
    finishLoad?.()
    await expect(continuing).resolves.toMatchObject({ width: 100, height: 150 })
  })

  it("evicts a rejected image promise so the same source can retry", async () => {
    let attempts = 0
    class FakeImage {
      height = 150
      width = 100
      #error?: () => void
      #load?: () => void

      addEventListener(type: string, listener: () => void) {
        if (type === "error") this.#error = listener
        if (type === "load") this.#load = listener
      }

      set src(_value: string) {
        attempts += 1
        queueMicrotask(() => (attempts === 1 ? this.#error?.() : this.#load?.()))
      }
    }
    globalThis.Image = FakeImage as unknown as typeof Image

    await expect(loadDrawable("/retry-test-image.png")).rejects.toThrow(/Could not load/)
    await expect(loadDrawable("/retry-test-image.png")).resolves.toMatchObject({
      width: 100,
      height: 150,
    })
    expect(attempts).toBe(2)
  })

  it("does not collide distinct sources returned for the same semantic role", async () => {
    const sources: string[] = []
    class FakeImage {
      height = 150
      width = 100
      #load?: () => void

      addEventListener(type: string, listener: () => void) {
        if (type === "load") this.#load = listener
      }

      set src(value: string) {
        sources.push(value)
        queueMicrotask(() => this.#load?.())
      }
    }
    globalThis.Image = FakeImage as unknown as typeof Image

    const [first, second] = await Promise.all([
      loadDrawable("/resolver-a/image.png"),
      loadDrawable("/resolver-b/image.png"),
    ])

    expect(first).not.toBe(second)
    expect(sources).toHaveLength(2)
  })

  it("revokes temporary Blob URLs after image loading", async () => {
    class FakeImage {
      height = 150
      width = 100
      #load?: () => void

      addEventListener(type: string, listener: () => void) {
        if (type === "load") this.#load = listener
      }

      set src(_value: string) {
        queueMicrotask(() => this.#load?.())
      }
    }
    globalThis.Image = FakeImage as unknown as typeof Image
    const originalCreate = Object.getOwnPropertyDescriptor(URL, "createObjectURL")
    const originalRevoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL")
    const create = vi.fn(() => "blob:temporary-image")
    const revoke = vi.fn()
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: create },
      revokeObjectURL: { configurable: true, value: revoke },
    })

    try {
      await loadDrawable(new Blob(["image"]))
      expect(create).toHaveBeenCalledOnce()
      expect(revoke).toHaveBeenCalledWith("blob:temporary-image")
    } finally {
      if (originalCreate) Object.defineProperty(URL, "createObjectURL", originalCreate)
      else Reflect.deleteProperty(URL, "createObjectURL")
      if (originalRevoke) Object.defineProperty(URL, "revokeObjectURL", originalRevoke)
      else Reflect.deleteProperty(URL, "revokeObjectURL")
    }
  })
})
