/**
 * Measurements quoted in this post, kept beside it rather than inline in the prose.
 *
 * Every number here came out of a benchmark run recorded at the time; nothing is estimated. Keeping
 * them as data means the figure and the table view under it can never drift apart from each other.
 */

/**
 * What a reader waits through before a browser shows them one cut-out edge.
 *
 * Measured in headless Chrome on an i7-12700H with the GPU disabled, one WASM thread, in a
 * dedicated Worker. The model is loaded from disk rather than fetched, so the first stage is
 * loading and session setup with no network in it. The prompt stage is the one that repeats:
 * every later click pays it again.
 *
 * Ordered the way the wait happens, not by size — these run one after another and add up to the
 * total underneath them.
 */
export const coldFirstAlpha = [
  {
    id: "setup",
    label: "Model loading and session setup",
    note: "once per page",
    value: 1738.5,
  },
  { id: "encoder", label: "Encoder", note: "once per image", value: 7606.7 },
  { id: "prompt", label: "First prompt", note: "and every click after it", value: 7934.9 },
] as const

/**
 * ZIM ViT-B encoder variants: size against how far each one's soft alpha drifted from the FP32
 * reference, measured inside the uncertain bands where a matte actually lives.
 */
export const quantizationVariants = [
  { emphasis: true, id: "fp32", label: "FP32", x: 343.97, y: 0 },
  { emphasis: true, id: "fp16", label: "FP16", x: 172.23, y: 0.0003 },
  { emphasis: true, id: "int8", label: "INT8", x: 104.15, y: 0.00145 },
  { id: "hqq32", label: "INT4 HQQ b32", x: 80.73, y: 0.01527 },
  { id: "rtn32", label: "INT4 RTN b32", x: 71.87, y: 0.01673 },
  { id: "hqq64", label: "INT4 HQQ b64", x: 70.61, y: 0.01762 },
  { id: "rtn64", label: "INT4 RTN b64", x: 66.18, y: 0.01837 },
  { id: "hqq128", label: "INT4 HQQ b128", x: 65.54, y: 0.02218 },
  { emphasis: true, id: "rtn128", label: "INT4 RTN b128", x: 63.33, y: 0.02406 },
] as const

/**
 * End-to-end time to one mask, averaged over the same 25 artworks, on an RTX 4070 Laptop.
 *
 * The SAM3 rows are the full pipeline: look at the artwork, write a phrase, run the segmenter. The
 * ToonOut row is the whole thing — there is no phrase stage to add to it.
 */
export const maskPipelines = [
  { label: "WD tagger → SAM3", note: "anime tag classifier", value: 3535.01 },
  { label: "LFM2.5-VL → SAM3", note: "noun phrases", value: 3487.65 },
  { label: "FastVLM → SAM3", note: "noun phrases", value: 2820.83 },
  { label: "Florence-2 → SAM3", note: "phrase extraction", value: 2202.78 },
  { emphasis: true, label: "ToonOut", note: "no phrase stage at all", value: 484.18 },
] as const

/**
 * What each AVIF quality setting costs a mask, over fifteen real alphas at the size they ship at.
 *
 * Each entry is `[quality, size reduction against PNG in %, mean absolute alpha error in % of the
 * full 8-bit range]`, ordered by reduction so the curve never folds back. The settings are sampled
 * the way a person actually chooses one: every step from 100 down to 90, every second step to 80,
 * then every fifth step to 10, which is far past anything worth shipping.
 *
 * Encoded at effort 10, the same setting the pipeline uses. The encoder's quantizer has 64 steps,
 * so a few neighbouring qualities land on the same file and only the higher one is kept.
 */
const avifSweep: readonly (readonly [number, number, number])[] = [
  [100, 40.37, 0.0017],
  [99, 68.91, 0.0072],
  [97, 74.67, 0.0092],
  [96, 79.08, 0.011],
  [94, 81.34, 0.0121],
  [92, 83.45, 0.0133],
  [91, 84.66, 0.0142],
  [88, 86.7, 0.0161],
  [86, 87.43, 0.0172],
  [84, 87.95, 0.0181],
  [82, 88.41, 0.0189],
  [80, 89.1, 0.0209],
  [75, 89.99, 0.0241],
  [70, 90.63, 0.0277],
  [65, 91.22, 0.0313],
  [60, 91.93, 0.0356],
  [55, 92.76, 0.0423],
  [50, 93.79, 0.0527],
  [45, 94.32, 0.0613],
  [40, 95.03, 0.0732],
  [35, 95.6, 0.0859],
  [30, 96.07, 0.101],
  [25, 96.53, 0.1197],
  [20, 96.88, 0.1393],
  [15, 97.3, 0.165],
  [10, 97.63, 0.2206],
]

/**
 * The sweep plotted as the trade it is: what the file still weighs along x, what it cost along y.
 * Quality is the knob rather than an outcome, so it takes no axis — on one it read as though less
 * quality were the goal instead of the smaller file it buys.
 *
 * Size is a share of the PNG, not a saving off it, on a log axis: every setting worth considering
 * lands between 89% and 98% off, which is a sliver of a linear axis, and what separates them are
 * ratios.
 */
export const avifErrorBySize = avifSweep
  .map(([, reduction, error]) => [Number((100 - reduction).toFixed(2)), error] as const)
  // Ascending in x. The sweep is recorded from q100 down, which is largest file first, and a
  // series handed over backwards draws its end labels at the wrong ends.
  .sort((a, b) => a[0] - b[0])

const avifQualityBySize = new Map(
  avifSweep.map(([quality, reduction]) => [Number((100 - reduction).toFixed(2)), quality]),
)

/** Which setting produced a point, for the readout and the table. */
export function avifQualityAt(size: number) {
  const quality = avifQualityBySize.get(size)
  return quality === undefined ? "n/a" : `q${quality}`
}

/** Where the shipped setting sits on that curve: 6.21% of the PNG, which is 93.79% off it. */
export const AVIF_SHIPPED_SIZE = 6.21

/** A few settings named along the curve, spaced so their labels never touch. */
export const avifQualityWaypoints = [
  { label: "q99", x: 31.09 },
  { label: "q88", x: 13.3 },
  { label: "q20", x: 3.12 },
] as const
