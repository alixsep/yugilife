import { decodePreparedTextures, prepareTemplateTextures } from "yugilife-core/color-grading"

import { readPreparedTextures, storePreparedTextures } from "./prepared-texture-storage"

import type { CardTemplateBundle, PreparedTextures } from "yugilife-core"
import type { TemplateLoadProgress } from "yugilife-templates"

export interface ActivePreparedTextures {
  /**
   * The exact bundle these textures were graded from.
   *
   * Identity, not `id` and `version`: a user template may be edited — new color presets included —
   * without minting a new version, and pairing by name would hand the renderer textures graded from
   * the presets that edit replaced. Every activation validates a fresh bundle object, so comparing
   * references is both cheap and exact.
   */
  readonly bundle: CardTemplateBundle
  /**
   * Undefined when this template has nothing to prepare, or when preparing it failed. Either way
   * the bundle is settled and renders — grading live, as an unprepared render always did.
   */
  readonly textures: PreparedTextures | undefined
}

/** Grading the textures of a downloaded template, reported the way its download was. */
export interface TexturePreparationProgress {
  readonly completed: number
  readonly phase: "preparing"
  readonly total: number
}

/** Everything a template goes through between being selected and drawing its first card. */
export type TemplateActivationProgress = TemplateLoadProgress | TexturePreparationProgress

/** One determinate percentage across both activation phases, or undefined while a total is unknown. */
export function activationProgressPercent(progress: TemplateActivationProgress) {
  const done = progress.phase === "preparing" ? progress.completed : progress.loaded
  const total = progress.total ?? 0
  return total > 0 ? Math.min(100, Math.round((done / total) * 100)) : undefined
}

export interface PrepareTexturesOptions {
  /**
   * Finished textures against the total, from the moment preparation begins. The total is zero
   * until it is known, which is the honest reading while the cache is still being consulted: a
   * restored template grades nothing at all.
   */
  readonly onProgress?: ((completed: number, total: number) => void) | undefined
  readonly signal?: AbortSignal | undefined
}

/**
 * Prepared textures for one activated bundle, graded once per template release.
 *
 * Color grading is the same pixel work for every card on a given template, and a browser session
 * keeps none of it: without this, every reload re-grades the whole frame and effect-box set before
 * the first card appears. Preparing once at activation and persisting the result moves that cost off
 * the render path entirely for every later session.
 *
 * It is deliberately best-effort. Preparing or persisting can fail — a browser with no storage
 * quota, a decoder that refuses a plane — and a failure only means this session grades live, exactly
 * as it did before. A failure therefore still settles; only a superseded activation resolves to
 * nothing, because something newer is already deciding what to draw.
 */
export async function acquirePreparedTextures(
  bundle: CardTemplateBundle,
  options: PrepareTexturesOptions = {},
): Promise<ActivePreparedTextures | undefined> {
  const { id: templateId, version } = bundle.manifest
  try {
    options.onProgress?.(0, 0)
    const stored = await readPreparedTextures(templateId, version)
    if (options.signal?.aborted) return undefined
    if (stored) {
      return { bundle, textures: stored.length > 0 ? decodePreparedTextures(stored) : undefined }
    }

    const { payloads, textures } = await prepareTemplateTextures(bundle, options)
    if (options.signal?.aborted) return undefined
    if (payloads.length === 0) return { bundle, textures: undefined }
    try {
      await storePreparedTextures(templateId, version, payloads)
    } catch (error: unknown) {
      if (import.meta.env.DEV) {
        console.warn(`Could not cache prepared textures for "${templateId}".`, error)
      }
    }
    return { bundle, textures }
  } catch (error: unknown) {
    if (options.signal?.aborted) return undefined
    if (import.meta.env.DEV) {
      console.warn(`Could not prepare textures for "${templateId}".`, error)
    }
    return { bundle, textures: undefined }
  }
}

/** The textures graded from this exact bundle, or undefined when they belong to another one. */
export function preparedTexturesForBundle(
  prepared: ActivePreparedTextures | undefined,
  bundle: CardTemplateBundle | undefined,
) {
  return preparedTexturesSettled(prepared, bundle) ? prepared?.textures : undefined
}

/**
 * Whether this bundle has finished preparing, successfully or not.
 *
 * The first card waits for this. Rendering it as soon as the bundle arrived meant drawing it once
 * with live grading and again the moment the textures landed — the same card, twice, for no visible
 * gain. Waiting turns that into one render behind the progress the download was already showing.
 */
export function preparedTexturesSettled(
  prepared: ActivePreparedTextures | undefined,
  bundle: CardTemplateBundle | undefined,
) {
  return prepared !== undefined && bundle !== undefined && prepared.bundle === bundle
}
