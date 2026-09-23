type RgbColor = {
  r: number
  g: number
  b: number
}

type RgbaColor = RgbColor & { a: number }

export type ContrastForeground = "#000000" | "#ffffff"

function linearizeSrgbChannel(channel: number) {
  const normalized = channel / 255
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance({ r, g, b }: RgbColor) {
  return (
    0.2126 * linearizeSrgbChannel(r) +
    0.7152 * linearizeSrgbChannel(g) +
    0.0722 * linearizeSrgbChannel(b)
  )
}

export function contrastingForeground(rgb: RgbColor): ContrastForeground {
  const luminance = relativeLuminance(rgb)
  const contrastWithBlack = (luminance + 0.05) / 0.05
  const contrastWithWhite = 1.05 / (luminance + 0.05)
  return contrastWithBlack >= contrastWithWhite ? "#000000" : "#ffffff"
}

function parseHexColor(color: string): RgbaColor | null {
  const match = /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.exec(color.trim())
  if (!match) return null

  const hex = match[1]
  if (!hex) return null
  const expanded =
    hex.length <= 4
      ? [...hex]
          .slice(0, 3)
          .map((character) => character.repeat(2))
          .join("")
      : hex.slice(0, 6)

  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
    a:
      hex.length === 4 || hex.length === 8
        ? Number.parseInt(hex.length === 4 ? `${hex[3]}${hex[3]}` : hex.slice(6, 8), 16) / 255
        : 1,
  }
}

function resolveBrowserColor(color: string): RgbaColor | null {
  if (typeof document === "undefined") return null

  const canvas = document.createElement("canvas")
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) return null

  context.clearRect(0, 0, 1, 1)
  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)
  const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data
  if (r === undefined || g === undefined || b === undefined || alpha === undefined) return null
  return { r, g, b, a: alpha / 255 }
}

function resolveCssColor(color: string) {
  return parseHexColor(color) ?? resolveBrowserColor(color)
}

function composite(foreground: RgbaColor, backdrop: RgbaColor): RgbColor {
  const alpha = foreground.a + backdrop.a * (1 - foreground.a)
  if (alpha === 0) return { r: 0, g: 0, b: 0 }

  return {
    r: (foreground.r * foreground.a + backdrop.r * backdrop.a * (1 - foreground.a)) / alpha,
    g: (foreground.g * foreground.a + backdrop.g * backdrop.a * (1 - foreground.a)) / alpha,
    b: (foreground.b * foreground.a + backdrop.b * backdrop.a * (1 - foreground.a)) / alpha,
  }
}

/** Chooses whichever of pure black or white has greater WCAG contrast. */
export function foregroundForCssColor(
  color: string,
  backdropColor = "#ffffff",
): ContrastForeground {
  const resolved = resolveCssColor(color)
  if (!resolved) return "#000000"

  const backdrop = resolveCssColor(backdropColor) ?? { r: 255, g: 255, b: 255, a: 1 }
  return contrastingForeground(composite(resolved, backdrop))
}
