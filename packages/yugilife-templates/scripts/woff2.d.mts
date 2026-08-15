export function isYugilifeConvertibleFont(file: string): boolean
export function woff2FileName(file: string): string
export function convertToWoff2(sourceFile: string): Promise<Uint8Array>

export interface YugilifeWoff2Plugin {
  name: "yugilife-woff2"
  apply: "build"
  enforce: "pre"
  load(id: string): Promise<string | null>
}

export function yugilifeWoff2(): YugilifeWoff2Plugin
