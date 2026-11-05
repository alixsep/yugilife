export const cliBatch = [
  { label: "TypeScript, in Chromium", note: "one warm page", value: 96.7 },
  { label: "Rust, 1 thread", note: "render-batch --jobs 1", value: 17.5 },
  {
    emphasis: true,
    label: "Rust, 20 threads",
    note: "render-batch, all cores",
    value: 2.13,
  },
] as const

export const firstRender = [
  { label: "Chromium, TypeScript core", value: 248 },
  { emphasis: true, label: "Chromium, Rust core", note: "AV1 decoded by WebCodecs", value: 78 },
  { label: "Firefox, TypeScript core", value: 559 },
  { emphasis: true, label: "Firefox, Rust core", note: "AV1 decoded by rav1d", value: 252 },
] as const

export const peakMemory = [
  { label: "TypeScript, in Chromium", note: "browser process tree", value: 8256 },
  { emphasis: true, label: "Rust, 20 threads", value: 543 },
  { emphasis: true, label: "Rust, 1 thread", value: 132 },
] as const

export const framesWhileTyping = [
  { label: "Chromium, TypeScript core", value: 357 },
  { emphasis: true, label: "Chromium, Rust core in a worker", value: 496 },
  { label: "Firefox, TypeScript core", value: 371 },
  { emphasis: true, label: "Firefox, Rust core in a worker", value: 514 },
] as const
