const pathNumberPattern = /-?\d*\.?\d+/g

/**
 * Interpolate one path's `d` into another's, number by number in order.
 *
 * Both paths must carry the same commands in the same order, so that the nth number in one means
 * the same thing as the nth in the other — the swept shapes are all written `M a b V c Q d e f g
 * V h z` for exactly that reason. Shared by the page transition and the donate screen's band,
 * which sweeps the same way from the opposite edge.
 */
export function createPathInterpolator(from: string, to: string) {
  const fromNumbers = from.match(pathNumberPattern)?.map(Number) ?? []
  const toNumbers = to.match(pathNumberPattern)?.map(Number) ?? []

  return (progress: number) => {
    let numberIndex = 0

    return to.replace(pathNumberPattern, () => {
      const fromValue = fromNumbers[numberIndex] ?? 0
      const toValue = toNumbers[numberIndex] ?? fromValue
      numberIndex += 1
      return String(fromValue + (toValue - fromValue) * progress)
    })
  }
}
