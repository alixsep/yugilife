import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react"

import { parseRichText, plainTextFromRichText, renderCard } from "yugilife-core"

import { createTextLayerFieldResolver } from "@/lib/card-text-fields"

import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react"
import type {
  CardData,
  LayerDefinition,
  LayerVisibility,
  RenderManifest,
  RenderOptions,
  RenderSegment,
  SvgElementDefinition,
  TextLayer,
} from "yugilife-core"

export interface CardRenderMetadata {
  createRenderManifest(): Promise<RenderManifest>
  textFields(): readonly CardRenderedTextField[]
}

export interface CardRenderedTextField {
  readonly controlIndex?: number | undefined
  readonly elementIndex: number
  readonly field: string
  readonly segmentIndex: number
}

export type CardProps = Omit<ComponentPropsWithoutRef<"div">, "children" | "onError"> &
  RenderOptions & {
    card: CardData
    debugLogging?: boolean
    onError?: (error: Error) => void
    onRenderMetadata?: (metadata: CardRenderMetadata | undefined) => void
    onReady?: () => void
    /**
     * Explicit invalidation for mutable external inputs. Immutable card, template, asset, renderer,
     * layer, and preset inputs are otherwise compared by reference.
     */
    renderRevision?: number | string
  }

const overlayStyle: CSSProperties = {
  display: "block",
  height: "100%",
  inset: 0,
  position: "absolute",
  width: "100%",
}

const reactSvgAttributeNames: Readonly<Record<string, string>> = {
  "baseline-shift": "baselineShift",
  "dominant-baseline": "dominantBaseline",
  "font-family": "fontFamily",
  "font-size": "fontSize",
  "font-style": "fontStyle",
  "font-weight": "fontWeight",
  "letter-spacing": "letterSpacing",
  "stroke-width": "strokeWidth",
  "text-anchor": "textAnchor",
  "xml:space": "xmlSpace",
}

let nextCardDebugInstanceId = 1

function summarizeCardValue(value: unknown) {
  if (typeof value === "string") return { type: "string", length: value.length }
  if (Array.isArray(value)) return { type: "array", length: value.length }
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return { type: value.constructor.name, size: value.size, mimeType: value.type }
  }
  return value
}

function summarizeCard(card: CardData) {
  return Object.fromEntries(
    Object.entries(card).map(([field, value]) => [field, summarizeCardValue(value)]),
  )
}

function summarizeRenderOptions({
  assets,
  layerRenderers,
  layers,
  presetOverrides,
  presentationOverrides,
  suppliedSignal,
  templateBundle,
}: {
  assets: RenderOptions["assets"]
  layerRenderers: RenderOptions["layerRenderers"]
  layers: RenderOptions["layers"]
  presetOverrides: RenderOptions["presetOverrides"]
  presentationOverrides: RenderOptions["presentationOverrides"]
  suppliedSignal: RenderOptions["signal"]
  templateBundle: RenderOptions["templateBundle"]
}) {
  return {
    assets: assets ? Object.keys(assets).length : 0,
    layerRenderers: layerRenderers ? Object.keys(layerRenderers).length : 0,
    layers: layers ? Object.keys(layers).length : 0,
    presetOverrides: presetOverrides ? Object.keys(presetOverrides).length : 0,
    presentationOverrides: presentationOverrides ? JSON.stringify(presentationOverrides).length : 0,
    suppliedSignal: Boolean(suppliedSignal),
    templateId: templateBundle.manifest.id,
  }
}

function svgNode(element: SvgElementDefinition, key: string): ReactNode {
  const attributes = Object.fromEntries(
    Object.entries(element.attributes ?? {}).map(([name, value]) => [
      reactSvgAttributeNames[name] ?? name,
      value,
    ]),
  )
  const children = [
    element.text,
    ...(element.children ?? []).map((child, index) => svgNode(child, `${key}-${index}`)),
  ].filter((child) => child !== undefined)
  return createElement(element.tag, { ...attributes, key }, ...children)
}

function visibleTextLayers(
  layers: readonly LayerDefinition[],
  visibility: LayerVisibility,
): TextLayer[] {
  const result: TextLayer[] = []
  for (const layer of layers) {
    if (!(visibility[layer.id] ?? layer.defaultVisible ?? true)) continue
    if (layer.kind === "group" && "layers" in layer && Array.isArray(layer.layers)) {
      result.push(...visibleTextLayers(layer.layers as readonly LayerDefinition[], visibility))
    } else if (layer.kind === "text") {
      result.push(layer as TextLayer)
    }
  }
  return result
}

function RasterSegment({
  canvas,
  height,
  width,
}: {
  canvas: HTMLCanvasElement
  height: number
  width: number
}) {
  const attach = useCallback(
    (target: HTMLCanvasElement | null) => {
      const context = target?.getContext("2d")
      if (!target || !context) return
      context.clearRect(0, 0, width, height)
      context.drawImage(canvas, 0, 0)
    },
    [canvas, height, width],
  )
  return (
    <canvas ref={attach} aria-hidden="true" height={height} style={overlayStyle} width={width} />
  )
}

/**
 * Latest-value ref for inputs that must not themselves trigger a render, such as an unmemoized
 * `onReady`/`onError` callback. Synced in an effect so nothing is written during render.
 */
function useLatest<T>(value: T) {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  })
  return ref
}

export function Card({
  assets,
  card,
  className,
  debugLogging = false,
  layerRenderers,
  layers,
  onError,
  onReady,
  onRenderMetadata,
  presetOverrides,
  presentationOverrides,
  renderRevision,
  signal: suppliedSignal,
  style,
  templateBundle,
  ...props
}: CardProps) {
  const debugInstanceId = useRef(nextCardDebugInstanceId++)
  const renderAttemptCount = useRef(0)
  const previousEffectInputs = useRef<Record<string, unknown> | undefined>(undefined)

  const template = templateBundle.template
  const [error, setError] = useState<string>()
  const [renderSegments, setRenderSegments] = useState<readonly RenderSegment[]>([])
  const callbacks = useLatest({ onError, onReady, onRenderMetadata })

  const { width, height } = template.dimensions
  const viewBox = useMemo(() => `0 0 ${width} ${height}`, [width, height])
  const accessibleName = useMemo(
    () => plainTextFromRichText(parseRichText(card.name).document),
    [card.name],
  )

  if (debugLogging) {
    console.log("[Yugilife Card] component render", {
      card: summarizeCard(card),
      templateId: templateBundle.manifest.id,
      segmentCount: renderSegments.length,
    })
  }

  useEffect(() => {
    let active = true
    let settled = false
    const instanceId = debugInstanceId.current
    const renderAttempt = ++renderAttemptCount.current
    const startedAt = typeof performance === "undefined" ? 0 : performance.now()
    const controller = new AbortController()
    callbacks.current.onRenderMetadata?.(undefined)
    const suppliedSignalForRender = suppliedSignal
    const abortFromSuppliedSignal = () => controller.abort(suppliedSignalForRender?.reason)
    if (suppliedSignalForRender?.aborted) {
      abortFromSuppliedSignal()
    } else {
      suppliedSignalForRender?.addEventListener("abort", abortFromSuppliedSignal, { once: true })
    }
    const options = {
      assets,
      layerRenderers,
      layers,
      presetOverrides,
      presentationOverrides,
      signal: controller.signal,
      templateBundle,
    } satisfies RenderOptions

    const effectInputs: Record<string, unknown> = {
      assets,
      card,
      layerRenderers,
      layers,
      presetOverrides,
      presentationOverrides,
      renderRevision,
      suppliedSignal,
      templateBundle,
      callbacks,
    }
    const previousInputs = previousEffectInputs.current
    const changedInputs = previousInputs
      ? Object.keys(effectInputs).filter((key) => previousInputs[key] !== effectInputs[key])
      : ["initial mount"]
    previousEffectInputs.current = effectInputs

    if (debugLogging) {
      console.groupCollapsed(
        `[Yugilife Card] render attempt #${renderAttempt} (instance ${debugInstanceId.current})`,
      )
      console.log("effect dependency identities changed:", changedInputs)
      console.log("render input summary:", {
        card: summarizeCard(card),
        options: summarizeRenderOptions({
          assets,
          layerRenderers,
          layers,
          presetOverrides,
          presentationOverrides,
          suppliedSignal,
          templateBundle,
        }),
      })
      console.log("raw render inputs:", {
        card,
        layers,
        presetOverrides,
        presentationOverrides,
      })
      console.groupEnd()
    }

    // Reading the revision makes explicit that it is an invalidation token, not renderer data.
    void renderRevision
    void renderCard(card, options)
      .then(async (rendered) => {
        settled = true
        if (debugLogging) {
          console.log("[Yugilife Card] render completed", {
            instance: debugInstanceId.current,
            renderAttempt,
            durationMs: startedAt === 0 ? undefined : performance.now() - startedAt,
            segments: rendered.renderSegments.length,
            vectorLayers: rendered.vectorLayers.length,
            warnings: rendered.warnings.length,
          })
        }
        if (!active || controller.signal.aborted) return
        const previewSegments = await rendered.toOutlinedSegments()
        if (!active || controller.signal.aborted) return
        setError(undefined)
        setRenderSegments(previewSegments)
        let textFields: readonly CardRenderedTextField[] | undefined
        callbacks.current.onRenderMetadata?.({
          createRenderManifest: () => rendered.createRenderManifest(),
          textFields: () => {
            if (textFields) return textFields
            const fieldsForLayer = createTextLayerFieldResolver(
              templateBundle.template,
              rendered.presentation,
            )
            const visibleFields = visibleTextLayers(templateBundle.template.layers, {
              ...rendered.presentation.layerVisibility,
              ...(layers ?? {}),
            }).map((layer) => ({
              controlIndex: layer.format === "pair" ? layer.pairIndex : undefined,
              field: fieldsForLayer(layer)[0],
            }))
            const result: CardRenderedTextField[] = []
            let textIndex = 0
            rendered.renderSegments.forEach((segment, segmentIndex) => {
              if (segment.kind !== "vector") return
              segment.elements.forEach((element, elementIndex) => {
                if (element.tag !== "text") return
                const target = visibleFields[textIndex++]
                if (target?.field) {
                  result.push({
                    controlIndex: target.controlIndex,
                    elementIndex,
                    field: target.field,
                    segmentIndex,
                  })
                }
              })
            })
            textFields = Object.freeze(result)
            return textFields
          },
        })
        callbacks.current.onReady?.()
      })
      .catch((reason: unknown) => {
        settled = true
        if (debugLogging) {
          console.error("[Yugilife Card] render failed or was aborted", {
            instance: instanceId,
            renderAttempt,
            durationMs: startedAt === 0 ? undefined : performance.now() - startedAt,
            active,
            aborted: controller.signal.aborted,
            reason,
          })
        }
        if (!active || controller.signal.aborted) {
          // An aborted render is a superseded render, not a failure. Clear any stale error so the
          // component does not keep showing a message for a render nobody is waiting on.
          if (active) setError(undefined)
          return
        }
        const renderError = reason instanceof Error ? reason : new Error(String(reason))
        setError(renderError.message)
        callbacks.current.onError?.(renderError)
      })
    return () => {
      active = false
      suppliedSignalForRender?.removeEventListener("abort", abortFromSuppliedSignal)
      controller.abort()
      if (debugLogging) {
        console.warn("[Yugilife Card] render cleanup / abort", {
          instance: instanceId,
          renderAttempt,
          settled,
        })
      }
    }
  }, [
    assets,
    card,
    debugLogging,
    layerRenderers,
    layers,
    presetOverrides,
    presentationOverrides,
    renderRevision,
    suppliedSignal,
    templateBundle,
    callbacks,
  ])

  return (
    <div
      {...props}
      aria-label={props["aria-label"] ?? accessibleName}
      className={className}
      data-template={templateBundle.manifest.id}
      role="img"
      style={{
        aspectRatio: `${width} / ${height}`,
        position: "relative",
        ...style,
      }}
    >
      {renderSegments.map((segment, index) =>
        segment.kind === "raster" ? (
          <RasterSegment
            canvas={segment.canvas}
            height={height}
            key={`raster-${index}`}
            width={width}
          />
        ) : (
          <svg
            aria-hidden="true"
            height={height}
            key={`vector-${index}`}
            preserveAspectRatio="none"
            style={overlayStyle}
            viewBox={viewBox}
            width={width}
            xmlns="http://www.w3.org/2000/svg"
          >
            {segment.elements.map((element, elementIndex) =>
              svgNode(element, `${index}-${elementIndex}`),
            )}
          </svg>
        ),
      )}
      {error && (
        <span role="alert" style={{ position: "absolute" }}>
          Card rendering failed: {error}
        </span>
      )}
    </div>
  )
}
