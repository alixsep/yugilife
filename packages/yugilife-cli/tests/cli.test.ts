import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { runCli } from "../src/cli.js"
import { decodeRasterDataUrl, loadRenderRequest } from "../src/runtime/input.js"
import { compareTemplateVersions } from "../src/runtime/template-store.js"

const temporaryDirectories: string[] = []

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "yugilife-cli-test-"))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  delete process.env["YUGILIFE_TEMPLATE_HOME"]
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

function output() {
  let stdout = ""
  let stderr = ""
  return {
    io: {
      stderr: { write: (value: string) => ((stderr += value), true) },
      stdout: { write: (value: string) => ((stdout += value), true) },
    },
    read() {
      return { stderr, stdout }
    },
  }
}

describe("CLI argument boundary", () => {
  it("orders same-day template versions by numeric release sequence", () => {
    expect(compareTemplateVersions("2026.08.12", "2026.08.12.1")).toBeLessThan(0)
    expect(compareTemplateVersions("2026.08.12.2", "2026.08.12.10")).toBeLessThan(0)
    expect(compareTemplateVersions("2026.08.12", "2026.08.12")).toBe(0)
  })

  it("prints the version without starting the browser", async () => {
    const captured = output()

    await expect(runCli(["--version"], captured.io)).resolves.toBe(0)
    expect(captured.read()).toEqual({ stderr: "", stdout: "0.1.0\n" })
  })

  it("reports usage errors with a stable code", async () => {
    const captured = output()

    await expect(runCli(["not-a-command"], captured.io)).resolves.toBe(2)
    expect(captured.read().stderr).toContain("[ARGUMENT_ERROR]")
    expect(captured.read().stderr).toContain("Expected a command")
  })

  it("lists the locally packaged default without network access", async () => {
    const captured = output()

    await expect(runCli(["templates", "list"], captured.io)).resolves.toBe(0)
    expect(captured.read()).toEqual({
      stderr: "",
      stdout: "card/series-10@2026.08.15\tpackaged\tSeries 10\n",
    })
  })

  it("treats installing the packaged default as an idempotent local operation", async () => {
    const captured = output()

    await expect(
      runCli(["templates", "install", "card/series-10@2026.08.15"], captured.io),
    ).resolves.toBe(0)
    expect(captured.read()).toEqual({
      stderr: "",
      stdout: "card/series-10@2026.08.15 is already available locally.\n",
    })
  })

  it("requires an explicit registry for templates not packaged with the CLI", async () => {
    const captured = output()

    await expect(
      runCli(["templates", "install", "card/series-9@2026.08.12"], captured.io),
    ).resolves.toBe(1)
    expect(captured.read().stderr).toContain("[TEMPLATE_REGISTRY_UNAVAILABLE]")
  })

  it("installs and lists an exact verified template artifact", async () => {
    const directory = await temporaryDirectory()
    process.env["YUGILIFE_TEMPLATE_HOME"] = directory
    const sourceManifest = JSON.parse(
      await readFile(
        new URL("../../yugilife-templates/templates/card/series-10/manifest.json", import.meta.url),
        "utf8",
      ),
    ) as { assets: Record<string, string> }
    const sourceTemplate = JSON.parse(
      await readFile(
        new URL("../../yugilife-templates/templates/card/series-10/template.json", import.meta.url),
        "utf8",
      ),
    ) as unknown
    const artifact = Buffer.from(
      JSON.stringify({
        assets: Object.fromEntries(
          Object.keys(sourceManifest.assets).map((assetId) => [
            assetId,
            "data:application/octet-stream;base64,AA==",
          ]),
        ),
        colorPresets: {},
        format: "yugilife-template",
        formatVersion: 1,
        manifest: {
          ...sourceManifest,
          id: "card/series-9",
          name: "Series 9",
          version: "2026.08.12",
        },
        template: sourceTemplate,
      }),
    )
    const artifactUrl = `data:application/json;base64,${artifact.toString("base64")}`
    const catalogUrl = `data:application/json,${encodeURIComponent(
      JSON.stringify({
        templates: [
          {
            id: "card/series-9",
            sha256: createHash("sha256").update(artifact).digest("hex"),
            size: artifact.byteLength,
            url: artifactUrl,
            version: "2026.08.12",
          },
        ],
      }),
    )}`
    const captured = output()

    await expect(
      runCli(
        ["templates", "install", "card/series-9@2026.08.12", "--registry", catalogUrl],
        captured.io,
      ),
    ).resolves.toBe(0)
    expect(captured.read()).toEqual({
      stderr: "",
      stdout: "Installed card/series-9@2026.08.12.\n",
    })

    const listed = output()
    await expect(runCli(["templates", "list"], listed.io)).resolves.toBe(0)
    expect(listed.read().stdout).toContain("card/series-9@2026.08.12\tinstalled\tSeries 9\n")
  })

  it("rejects output formats before launching Chromium", async () => {
    const directory = await temporaryDirectory()
    const inputPath = path.join(directory, "card.json")
    await writeFile(inputPath, JSON.stringify({ card: { name: "Invalid output" } }))
    const captured = output()

    await expect(
      runCli(["render", inputPath, "--output", path.join(directory, "card.gif")], captured.io),
    ).resolves.toBe(2)
    expect(captured.read().stderr).toContain(".png, .jpg, .jpeg, .webp, or .svg")
  })

  it("validates raster-only arguments before launching Chromium", async () => {
    const directory = await temporaryDirectory()
    const inputPath = path.join(directory, "card.json")
    await writeFile(inputPath, JSON.stringify({ card: { name: "Invalid raster options" } }))

    for (const arguments_ of [
      ["--output", path.join(directory, "card.png"), "--quality", "90"],
      ["--output", path.join(directory, "card.svg"), "--width", "1200"],
      ["--output", path.join(directory, "card.webp"), "--background", "#fff"],
      ["--output", path.join(directory, "card.webp"), "--text-mode", "text"],
      ["--output", path.join(directory, "card.jpg"), "--width", "1200", "--height", "1700"],
    ]) {
      const captured = output()
      await expect(runCli(["render", inputPath, ...arguments_], captured.io)).resolves.toBe(1)
      expect(captured.read().stderr).toContain("[INPUT_INVALID]")
    }
  })
})

describe("JSON transport", () => {
  it("resolves image files relative to the input JSON, including unicode paths", async () => {
    const directory = await temporaryDirectory()
    const artworkPath = path.join(directory, "画像 with spaces.png")
    const inputPath = path.join(directory, "card.json")
    await writeFile(artworkPath, Buffer.from([137, 80, 78, 71]))
    await writeFile(
      inputPath,
      JSON.stringify({
        card: { name: "Transport" },
        files: { artwork: "./画像 with spaces.png" },
        template: "card/series-10",
      }),
    )

    const request = await loadRenderRequest(inputPath, path.join(directory, "card.svg"))
    expect(request.format).toBe("svg")
    expect(request.templateBundle.manifest).toMatchObject({
      id: "card/series-10",
      version: "2026.08.15",
    })
    expect(request.files.artwork).toMatch(/^data:image\/png;base64,/u)
  })

  it("decodes browser PNG data URLs", () => {
    expect(decodeRasterDataUrl("data:image/png;base64,iVBORw0=", "png", "card.png")).toEqual(
      Buffer.from([137, 80, 78, 71, 13]),
    )
  })

  it("derives JPEG and WebP formats from extensions and transports raster options", async () => {
    const directory = await temporaryDirectory()
    const inputPath = path.join(directory, "card.json")
    await writeFile(inputPath, JSON.stringify({ card: { name: "Raster options" } }))

    const jpeg = await loadRenderRequest(inputPath, path.join(directory, "card.jpeg"), {
      backgroundColor: "#abcdef",
      quality: 0.8,
      width: 1200,
    })
    expect(jpeg).toMatchObject({
      format: "jpeg",
      rasterOptions: {
        backgroundColor: "#abcdef",
        quality: 0.8,
        size: { width: 1200 },
      },
    })

    const webp = await loadRenderRequest(inputPath, path.join(directory, "card.webp"), { scale: 2 })
    expect(webp).toMatchObject({ format: "webp", rasterOptions: { size: { scale: 2 } } })
    expect(() => decodeRasterDataUrl("data:image/png;base64,AA==", "webp", "card.webp")).toThrow(
      /malformed WEBP output/,
    )
  })
})
