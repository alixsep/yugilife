import { renderCard, TemplateValidationError } from "yugilife-core"

import type {
  BrowserApi,
  BrowserRenderResponse,
  BrowserSmokeResult,
  SerializedRenderRequest,
  SerializedRenderWarning,
} from "../runtime/protocol.js"
import type { CardData, CardTemplate, RenderOptions } from "yugilife-core"

let activeAbortController: AbortController | undefined

const smokeTemplate: CardTemplate = {
  cardFields: [
    {
      defaultValue: "YugiLife CLI",
      kind: "text",
      label: "Name",
      name: "name",
      required: true,
    },
  ],
  dimensions: { height: 2, width: 2 },
  layers: [],
  schemaVersion: 1,
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isAborted(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}

function serializeError(error: unknown): BrowserRenderResponse {
  if (isAborted(error)) {
    return {
      error: { code: "ABORTED", message: "The render was aborted." },
      ok: false,
    }
  }
  if (error instanceof TemplateValidationError) {
    return {
      error: { code: "RENDER_VALIDATION_FAILED", message: error.message },
      ok: false,
    }
  }
  return {
    error: { code: "RENDER_FAILED", message: errorMessage(error) },
    ok: false,
  }
}

function asDataUrl(file: string) {
  if (!file.startsWith("data:")) throw new Error("Browser file payloads must be data URLs.")
  return file
}

function blobToDataUrl(blob: Blob, signal: AbortSignal) {
  const abortReason = (): Error =>
    signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The render was aborted.", "AbortError")
  if (signal.aborted) throw abortReason()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    const abort = () => reader.abort()
    const cleanup = () => signal.removeEventListener("abort", abort)
    reader.addEventListener(
      "load",
      () => {
        cleanup()
        if (typeof reader.result === "string") resolve(reader.result)
        else reject(new Error("Image encoding did not produce a data URL."))
      },
      { once: true },
    )
    reader.addEventListener(
      "error",
      () => {
        cleanup()
        reject(reader.error ?? new Error("Could not encode image output."))
      },
      { once: true },
    )
    reader.addEventListener(
      "abort",
      () => {
        cleanup()
        reject(abortReason())
      },
      { once: true },
    )
    signal.addEventListener("abort", abort, { once: true })
    reader.readAsDataURL(blob)
  })
}

function warningsFor(rendered: Awaited<ReturnType<typeof renderCard>>) {
  return rendered.warnings.map((warning): SerializedRenderWarning => ({
    code: warning.code,
    layerId: warning.layerId,
    length: warning.length,
    message: warning.message,
    offset: warning.offset,
  }))
}

async function render(request: SerializedRenderRequest): Promise<BrowserRenderResponse> {
  if (activeAbortController) {
    return {
      error: { code: "RENDER_FAILED", message: "The browser renderer is already busy." },
      ok: false,
    }
  }
  const controller = new AbortController()
  activeAbortController = controller
  try {
    const card = { ...request.card }
    const assets: Record<string, string> = {}
    for (const [key, file] of Object.entries(request.files)) {
      const dataUrl = asDataUrl(file)
      card[key] = dataUrl
      assets[key] = dataUrl
    }
    const renderOptions: RenderOptions = {
      assets,
      signal: controller.signal,
      templateBundle: request.templateBundle as RenderOptions["templateBundle"],
      ...(request.presentationOverrides === undefined
        ? {}
        : {
            presentationOverrides: request.presentationOverrides,
          }),
    }
    const rendered = await renderCard(card as CardData, renderOptions)
    const title = request.title === undefined ? {} : { title: request.title }
    const payload =
      request.format === "svg"
        ? await rendered.toSvg({ ...title, textMode: request.textMode ?? "paths" })
        : await blobToDataUrl(
            await rendered.toImage({ format: request.format, ...request.rasterOptions }),
            controller.signal,
          )
    return {
      format: request.format,
      ok: true,
      payload,
      warnings: warningsFor(rendered),
    }
  } catch (error) {
    return serializeError(error)
  } finally {
    activeAbortController = undefined
  }
}

async function smoke(): Promise<BrowserSmokeResult> {
  const rendered = await renderCard(
    { name: "YugiLife CLI" },
    {
      templateBundle: {
        assets: {},
        colorPresets: {},
        manifest: {
          assets: {},
          id: "card/cli-smoke",
          kind: "card",
          name: "CLI smoke",
          template: "template.json",
          version: "2026.01.01",
        },
        template: smokeTemplate,
      },
    },
  )
  return {
    dimensions: rendered.template.dimensions,
    ready: true,
  }
}

const api: BrowserApi = {
  cancel() {
    activeAbortController?.abort()
  },
  render,
  smoke,
}

;(globalThis as unknown as { __yugilifeCli: BrowserApi }).__yugilifeCli = api
