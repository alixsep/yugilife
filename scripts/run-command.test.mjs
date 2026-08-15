import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { runCommand } from "./run-command.mjs"

const resistantChild = [
  'process.on("SIGTERM", () => {})',
  'process.on("SIGINT", () => {})',
  "setInterval(() => {}, 1_000)",
].join(";")

test("an abort force-stops a child after the termination grace period", async () => {
  const controller = new AbortController()
  const reason = new Error("intentional test abort")
  const started = Date.now()
  const result = runCommand(process.execPath, ["-e", resistantChild], {
    quiet: true,
    signal: controller.signal,
    terminationGraceMs: 100,
    timeoutMs: 10_000,
  })

  setTimeout(() => controller.abort(reason), 100)
  await assert.rejects(result, (error) => error === reason)
  assert.ok(Date.now() - started < 2_000, "abort waited for the phase deadline")
})

test("a timeout force-stops a child and reports its phase", async () => {
  await assert.rejects(
    runCommand(process.execPath, ["-e", resistantChild], {
      label: "resistant test child",
      quiet: true,
      terminationGraceMs: 100,
      timeoutMs: 100,
    }),
    /resistant test child exceeded 100 ms and was terminated/,
  )
})

test("a timeout stops descendants as well as the direct child", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "yugilife-process-tree-"))
  const pidFile = path.join(temporaryDirectory, "descendant.pid")
  const descendant = [
    'process.on("SIGTERM", () => {})',
    'process.on("SIGINT", () => {})',
    "setInterval(() => {}, 1_000)",
  ].join(";")
  const parent = [
    'const { spawn } = require("node:child_process")',
    'const { writeFileSync } = require("node:fs")',
    `const child = spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], { stdio: "ignore" })`,
    `writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))`,
    'process.on("SIGTERM", () => {})',
    'process.on("SIGINT", () => {})',
    "setInterval(() => {}, 1_000)",
  ].join(";")

  try {
    await assert.rejects(
      runCommand(process.execPath, ["-e", parent], {
        quiet: true,
        terminationGraceMs: 100,
        timeoutMs: 300,
      }),
      /exceeded 300 ms and was terminated/,
    )
    const descendantPid = Number(await readFile(pidFile, "utf8"))
    let descendantExited = false
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        process.kill(descendantPid, 0)
      } catch (error) {
        if (error.code !== "ESRCH") throw error
        descendantExited = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.ok(descendantExited, "descendant survived process-tree termination")
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
})
