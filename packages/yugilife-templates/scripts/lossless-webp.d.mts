export function isYugilifeRasterImage(file: string): boolean
export function losslessWebpFileName(file: string): string
export function convertToLosslessWebp(source: string): Promise<Uint8Array>

export interface YugilifeLosslessWebpPlugin {
  name: "yugilife-lossless-webp"
  apply: "build"
  enforce: "pre"
  load(id: string): Promise<string | null>
}

export function yugilifeLosslessWebp(): YugilifeLosslessWebpPlugin
