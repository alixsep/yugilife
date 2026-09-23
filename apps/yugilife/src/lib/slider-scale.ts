/**
 * Maps a slider's semantic value range to its visual 0…1 track position.
 *
 * Keeping this contract separate from the slider renderer means a control can make small values
 * easier to tune without duplicating pointer, keyboard, hover, and resize logic. Implementations
 * must be monotonic and return values in the inclusive 0…1 interval.
 */
export interface SliderScale {
  positionToValue: (position: number, min: number, max: number) => number
  valueToPosition: (value: number, min: number, max: number) => number
}

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value))
}

export const linearSliderScale: SliderScale = {
  positionToValue(position, min, max) {
    if (max <= min) return min
    return min + clampUnit(position) * (max - min)
  },
  valueToPosition(value, min, max) {
    if (max <= min) return 0
    return clampUnit((value - min) / (max - min))
  },
}

function powerCurveExponents(midpoint: number, midpointPosition: number, min: number, max: number) {
  if (max <= min) return null
  const normalizedMidpoint = (midpoint - min) / (max - min)
  const normalizedMidpointPosition = clampUnit(midpointPosition)
  if (
    normalizedMidpoint <= 0 ||
    normalizedMidpoint >= 1 ||
    normalizedMidpointPosition <= 0 ||
    normalizedMidpointPosition >= 1
  ) {
    return null
  }

  // valuePosition = normalizedValue ** valueToPositionExponent. Solving that curve
  // at the requested midpoint gives the inverse exponent for positionToValue.
  const valueToPositionExponent =
    Math.log(normalizedMidpointPosition) / Math.log(normalizedMidpoint)
  return {
    positionToValueExponent: 1 / valueToPositionExponent,
    valueToPositionExponent,
  }
}

/**
 * Creates a continuous power-curve scale. `midpoint` is the semantic value that should land at
 * `midpointPosition` on the track. For example, pin sizes 4…128 with a midpoint of 32 at 0.5
 * use one smooth concave curve, rather than a visible slope change at 32.
 */
export function powerSliderScale(midpoint: number, midpointPosition = 0.5): SliderScale {
  return {
    positionToValue(position, min, max) {
      const exponents = powerCurveExponents(midpoint, midpointPosition, min, max)
      if (!exponents) {
        return linearSliderScale.positionToValue(position, min, max)
      }
      return min + Math.pow(clampUnit(position), exponents.positionToValueExponent) * (max - min)
    },
    valueToPosition(value, min, max) {
      const exponents = powerCurveExponents(midpoint, midpointPosition, min, max)
      if (!exponents) {
        return linearSliderScale.valueToPosition(value, min, max)
      }
      const normalizedValue = clampUnit((value - min) / (max - min))
      return Math.pow(normalizedValue, exponents.valueToPositionExponent)
    },
  }
}
