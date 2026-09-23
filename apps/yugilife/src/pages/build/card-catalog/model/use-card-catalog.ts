import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { usePageTransitionInProgress } from "@/components/page-transition-ready"
import { LOADING_COMPLETE_EVENT } from "@/lib/loading-screen-event"

import { loadCardCatalog, restoreCardCatalog, retryCardCatalogLoad } from "./card-catalog-loader"

import type {
  CardCatalogLoadProgress,
  CardCatalogSearchClient,
  LoadedCardCatalog,
} from "./card-catalog-loader"

export type CardCatalogManagerState =
  | { status: "idle" }
  | { status: "restoring" }
  | { progress: CardCatalogLoadProgress; status: "loading" }
  | {
      search: CardCatalogSearchClient
      source: LoadedCardCatalog["source"]
      status: "ready"
      warning?: string
    }
  | { message: string; status: "error" }

export interface CardCatalogManager {
  load: () => void
  state: CardCatalogManagerState
}

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load the card catalog."
}

export function useCardCatalog(): CardCatalogManager {
  const [state, setState] = useState<CardCatalogManagerState>({ status: "restoring" })
  const mounted = useRef(true)
  const request = useRef(0)
  const transitionInProgress = usePageTransitionInProgress()

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (transitionInProgress) return

    let idle: number | undefined
    let fallback: ReturnType<typeof setTimeout> | undefined
    const requestId = ++request.current
    const restore = () => {
      void restoreCardCatalog().then((restored) => {
        if (!mounted.current || request.current !== requestId) return
        setState(
          restored
            ? {
                search: restored.search,
                source: restored.source,
                status: "ready",
                ...(restored.warning ? { warning: restored.warning } : {}),
              }
            : { status: "idle" },
        )
      })
    }
    const scheduleRestore = () => {
      if (typeof requestIdleCallback === "function") {
        idle = requestIdleCallback(restore, { timeout: 1_000 })
      } else {
        fallback = setTimeout(restore, 0)
      }
    }
    const startupComplete = document.documentElement.dataset.loadingComplete === "true"
    if (startupComplete) scheduleRestore()
    else window.addEventListener(LOADING_COMPLETE_EVENT, scheduleRestore, { once: true })

    return () => {
      request.current += 1
      window.removeEventListener(LOADING_COMPLETE_EVENT, scheduleRestore)
      if (idle !== undefined) cancelIdleCallback(idle)
      if (fallback !== undefined) clearTimeout(fallback)
    }
  }, [transitionInProgress])

  const begin = useCallback(async (retry: boolean) => {
    const requestId = ++request.current
    const onProgress = (progress: CardCatalogLoadProgress) => {
      if (mounted.current && request.current === requestId) {
        setState({ progress, status: "loading" })
      }
    }
    onProgress({ phase: "checking" })
    try {
      const loaded = await (retry ? retryCardCatalogLoad(onProgress) : loadCardCatalog(onProgress))
      if (!mounted.current || request.current !== requestId) return
      setState({
        search: loaded.search,
        source: loaded.source,
        status: "ready",
        ...(loaded.warning ? { warning: loaded.warning } : {}),
      })
    } catch (error) {
      if (!mounted.current || request.current !== requestId) return
      setState({ message: messageFor(error), status: "error" })
    }
  }, [])

  // `begin` is stable, so the manager changes identity only when the catalog state itself does.
  // Rebuilding it on every render would defeat memoization in every consumer.
  const load = useCallback(() => void begin(state.status !== "idle"), [begin, state.status])

  return useMemo(() => ({ load, state }), [load, state])
}
