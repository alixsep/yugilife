import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { usePageTransitionInProgress } from "@/components/page-transition-ready"
import { LOADING_COMPLETE_EVENT } from "@/lib/loading-screen-event"

import {
  loadCardCatalog,
  restoreCardCatalog,
  retryCardCatalogLoad,
  updateRestoredCardCatalog,
} from "./card-catalog-loader"

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
    const publish = (
      catalog: LoadedCardCatalog | undefined,
      current = request.current === requestId,
    ) => {
      if (!mounted.current || !current) return false
      setState(
        catalog
          ? {
              search: catalog.search,
              source: catalog.source,
              status: "ready",
              ...(catalog.warning ? { warning: catalog.warning } : {}),
            }
          : { status: "idle" },
      )
      return true
    }
    const restore = () => {
      void restoreCardCatalog().then((restored) => {
        if (!publish(restored) || !restored) return
        // A saved copy is usable at once, but it must not outlive a newer published catalog.
        void updateRestoredCardCatalog().then((updated) => {
          // The loader already discards an update that an explicit load superseded, and it has
          // closed the worker this state still holds, so the replacement is published even if
          // this effect has since restarted for a route transition.
          if (updated) publish(updated, true)
        })
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
