if (process.platform !== "linux") {
  throw new Error(
    "Canonical visual baselines are Linux-only. Run pnpm check:portable on this platform; pnpm check remains the authoritative complete verification command on Linux and CI.",
  )
}

console.log("Verified Linux visual-baseline platform")
