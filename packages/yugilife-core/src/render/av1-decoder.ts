/// <reference lib="webworker" />
// Decodes the AV1 items of AVIF assets with the browser's own decoder (WebCodecs), which is much
// faster than decoding in WebAssembly, and gives the planes to the core. The core reads the color
// metadata and converts the planes itself, and AV1 decoding is exact by specification, so the card
// renders the same either way. Whenever this cannot be done, the core decodes the asset itself.

import type { CoreInstance, PackFile } from "../core/instance"

/**
 * Some browsers decode AV1 only to RGB (Firefox returns BGRX frames), which the core cannot use.
 * Once a browser shows it cannot provide YUV planes, this session stops asking it.
 */
let hostDecoding: "unknown" | "unusable" | "usable" = "unknown"

class UnusableDecoder extends Error {}

interface AvifItem {
  readonly buffer: number
  readonly codec: string
  readonly kind: "alpha" | "color"
}

interface DecodedPlanes {
  readonly height: number
  readonly layout: "I400" | "I420" | "I422" | "I444"
  readonly planes: readonly { readonly data: ArrayBuffer; readonly stride: number }[]
  readonly width: number
}

function isAvif(bytes: ArrayBuffer) {
  if (bytes.byteLength < 12) return false
  const view = new Uint8Array(bytes, 4, 8)
  const text = String.fromCharCode(...view)
  return text.startsWith("ftyp") && ["avif", "avis", "mif1", "msf1"].includes(text.slice(4))
}

async function decodeFrame(codec: string, data: ArrayBuffer): Promise<VideoFrame> {
  const config: VideoDecoderConfig = { codec, hardwareAcceleration: "prefer-software" }
  if (!(await VideoDecoder.isConfigSupported(config)).supported)
    throw new Error(`${codec} is unsupported.`)
  return await new Promise<VideoFrame>((resolve, reject) => {
    let settled = false
    const decoder = new VideoDecoder({
      error: (error) => {
        if (!settled) reject(error)
        settled = true
      },
      output: (frame) => {
        if (settled) {
          frame.close()
          return
        }
        settled = true
        resolve(frame)
      },
    })
    decoder.configure(config)
    decoder.decode(new EncodedVideoChunk({ data, timestamp: 0, type: "key" }))
    decoder
      .flush()
      .catch((error: unknown) => {
        if (!settled) reject(error instanceof Error ? error : new Error(String(error)))
        settled = true
      })
      .finally(() => {
        if (decoder.state !== "closed") decoder.close()
        if (!settled) reject(new Error("The AV1 decoder produced no frame."))
      })
  })
}

/** The frame's 8-bit planes in the layout the core reads. NV12 chroma is de-interleaved. */
async function framePlanes(frame: VideoFrame): Promise<DecodedPlanes> {
  const width = frame.visibleRect?.width ?? frame.codedWidth
  const height = frame.visibleRect?.height ?? frame.codedHeight
  const buffer = new Uint8Array(frame.allocationSize())
  const layout = await frame.copyTo(buffer)
  const plane = (index: number, rows: number) => {
    const { offset, stride } = layout[index] ?? { offset: 0, stride: 0 }
    return { data: buffer.slice(offset, offset + stride * rows).buffer, stride }
  }
  const chromaRows = Math.ceil(height / 2)
  switch (frame.format) {
    case "I420":
      return {
        height,
        layout: "I420",
        planes: [plane(0, height), plane(1, chromaRows), plane(2, chromaRows)],
        width,
      }
    case "I422":
      return {
        height,
        layout: "I422",
        planes: [plane(0, height), plane(1, height), plane(2, height)],
        width,
      }
    case "I444":
      return {
        height,
        layout: "I444",
        planes: [plane(0, height), plane(1, height), plane(2, height)],
        width,
      }
    case "NV12": {
      const chromaWidth = Math.ceil(width / 2)
      const { offset, stride } = layout[1] ?? { offset: 0, stride: 0 }
      const u = new Uint8Array(chromaWidth * chromaRows)
      const v = new Uint8Array(chromaWidth * chromaRows)
      for (let row = 0; row < chromaRows; row += 1) {
        for (let column = 0; column < chromaWidth; column += 1) {
          u[row * chromaWidth + column] = buffer[offset + row * stride + column * 2] ?? 0
          v[row * chromaWidth + column] = buffer[offset + row * stride + column * 2 + 1] ?? 0
        }
      }
      return {
        height,
        layout: "I420",
        planes: [
          plane(0, height),
          { data: u.buffer, stride: chromaWidth },
          { data: v.buffer, stride: chromaWidth },
        ],
        width,
      }
    }
    default:
      throw new UnusableDecoder(`Unsupported decoded frame format ${String(frame.format)}.`)
  }
}

async function decodePlanes(codec: string, data: ArrayBuffer) {
  const frame = await decodeFrame(codec, data)
  try {
    return await framePlanes(frame)
  } finally {
    frame.close()
  }
}

/** Decodes one AVIF asset with WebCodecs and gives the planes to the core, unless it has them. */
async function provide(core: CoreInstance, file: string, bytes: ArrayBuffer) {
  const { buffers, response } = core.call({ file, op: "avifItems" }, [[file, bytes]])
  const reply = response as { decoded?: boolean; items?: readonly AvifItem[] }
  if (reply.decoded || !reply.items) return
  const color = reply.items.find((item) => item.kind === "color")
  const alphaItem = reply.items.find((item) => item.kind === "alpha")
  if (!color) return
  const data = (item: AvifItem) => buffers[item.buffer] ?? new ArrayBuffer(0)
  const [image, alpha] = await Promise.all([
    decodePlanes(color.codec, data(color)),
    alphaItem ? decodePlanes(alphaItem.codec, data(alphaItem)) : undefined,
  ])
  const files: PackFile[] = [[file, bytes]]
  const planeEntry = (name: string, plane: { data: ArrayBuffer; stride: number } | undefined) => {
    if (!plane) return undefined
    files.push([name, plane.data])
    return { file: name, stride: plane.stride }
  }
  core.call(
    {
      ...(alpha
        ? {
            alpha: {
              ...planeEntry("a", alpha.planes[0]),
              height: alpha.height,
              width: alpha.width,
            },
          }
        : {}),
      file,
      height: image.height,
      layout: image.layout,
      op: "provideAvif",
      u: planeEntry("u", image.planes[1]),
      v: planeEntry("v", image.planes[2]),
      width: image.width,
      y: planeEntry("y", image.planes[0]),
    },
    files,
  )
}

/** Hands the AVIF assets of a render call to the browser's decoder first, where it can. */
export async function predecodeAvif(
  core: CoreInstance,
  header: Readonly<Record<string, unknown>>,
  files: readonly PackFile[],
) {
  if (typeof VideoDecoder === "undefined" || hostDecoding === "unusable") return
  if (header["op"] !== "render" && header["op"] !== "manifest") return
  const referenced = new Set<string>()
  for (const group of [header["cardAssets"], header["assets"]]) {
    for (const entry of Object.values((group ?? {}) as Record<string, { file?: string }>)) {
      if (entry.file) referenced.add(entry.file)
    }
  }
  await Promise.all(
    files
      .filter(([name, bytes]) => referenced.has(name) && isAvif(bytes))
      .map(([name, bytes]) =>
        provide(core, name, bytes).then(
          () => {
            hostDecoding = "usable"
          },
          (error: unknown) => {
            if (error instanceof UnusableDecoder && hostDecoding !== "usable")
              hostDecoding = "unusable"
          },
        ),
      ),
  )
}
