export interface IdentityColorPreset {
  method: "identity"
  metadata?: {
    target?: string
  }
}

export interface PolynomialColorPreset {
  method: "rgb-polynomial"
  exponents: readonly (readonly number[])[]
  coefficients: readonly (readonly number[])[]
  metadata?: {
    target?: string
  }
}

export interface HistogramColorPreset {
  method: "skimage-histogram-rgb-lut"
  channels: {
    r: readonly number[]
    g: readonly number[]
    b: readonly number[]
  }
  metadata?: {
    target?: string
  }
}

export type ColorPreset = IdentityColorPreset | PolynomialColorPreset | HistogramColorPreset
export type ColorPresetCollection = Readonly<Record<string, ColorPreset>>
