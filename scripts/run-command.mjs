import { spawn } from "node:child_process"

const maximumCapturedCharacters = 32_000

function appendTail(current, chunk) {
  const combined = current + String(chunk)
  return combined.length > maximumCapturedCharacters
    ? combined.slice(-maximumCapturedCharacters)
    : combined
}

/**
 * Runs one repository-tool child with bounded diagnostics, a phase deadline, and bounded shutdown.
 * Quiet output is always drained so a verbose child can never block on a full pipe.
 */
export async function runCommand(
  command,
  arguments_,
  { cwd, label, quiet = false, signal, terminationGraceMs = 5_000, timeoutMs = 300_000 } = {},
) {
  if (signal?.aborted) throw signal.reason
  if (label) console.log(`[${label}]`)

  await new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd,
      detached: process.platform !== "win32",
      stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    })
    let output = ""
    let settled = false
    let timedOut = false
    let forceTimer

    const capture = (chunk) => {
      output = appendTail(output, chunk)
    }
    child.stdout?.on("data", capture)
    child.stderr?.on("data", capture)

    const forceStopWindowsTree = () => {
      const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      })
      killer.once("error", () => child.kill())
      killer.once("close", (code) => {
        if (code !== 0) child.kill()
      })
    }
    const stop = (terminationSignal = "SIGTERM") => {
      if (child.pid === undefined || settled) return
      if (process.platform === "win32") {
        forceStopWindowsTree()
        return
      }
      try {
        process.kill(-child.pid, terminationSignal)
        return
      } catch (error) {
        if (error.code === "ESRCH") return
      }
      child.kill(terminationSignal)
    }
    const beginShutdown = () => {
      if (process.platform === "win32") {
        stop("SIGKILL")
        return
      }
      stop()
      if (forceTimer !== undefined) return
      forceTimer = setTimeout(() => stop("SIGKILL"), terminationGraceMs)
      forceTimer.unref()
    }
    const abort = () => beginShutdown()
    signal?.addEventListener("abort", abort, { once: true })

    const timer = setTimeout(() => {
      timedOut = true
      beginShutdown()
    }, timeoutMs)
    timer.unref()

    const settle = (callback) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(forceTimer)
      signal?.removeEventListener("abort", abort)
      callback()
    }

    child.on("error", (error) => settle(() => reject(error)))
    child.on("close", (code, terminationSignal) => {
      settle(() => {
        if (code === 0 && !signal?.aborted && !timedOut) {
          resolve()
          return
        }
        const rawReason = signal?.aborted
          ? signal.reason
          : timedOut
            ? new Error(`${label ?? command} exceeded ${timeoutMs} ms and was terminated.`)
            : new Error(`${label ?? command} exited with ${code ?? terminationSignal}.`)
        const reason = rawReason instanceof Error ? rawReason : new Error(String(rawReason))
        if (output.trim()) reason.message += `\n${output.trim()}`
        reject(reason)
      })
    })
  })
}
