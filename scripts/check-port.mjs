import net from "node:net"

const ports = process.argv.slice(2).map(Number)
if (
  ports.length === 0 ||
  ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65_535)
) {
  throw new Error("Expected one or more TCP port numbers.")
}

async function assertAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once("error", (error) => {
      const detail =
        error.code === "EADDRINUSE" ? "is already in use" : `cannot be bound (${error.message})`
      reject(
        new Error(
          `Required test port 127.0.0.1:${port} ${detail}. Stop the conflicting process or correct the local networking restriction before running browser tests.`,
          { cause: error },
        ),
      )
    })
    server.listen({ host: "127.0.0.1", port }, () => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  })
}

for (const port of ports) await assertAvailable(port)
console.log(`Verified available test ports: ${ports.join(", ")}`)
