/* eslint-disable react-refresh/only-export-components */

import { useLayoutEffect } from "react"

import { usePreferencesStore } from "./preferences-store"

import type { ReactNode } from "react"

function useAccentColorContext() {
  const accentColor = usePreferencesStore((state) => state.accentColor)
  const setAccentColor = usePreferencesStore((state) => state.setAccentColor)

  return { accentColor, setAccentColor }
}

function AccentColorProvider({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    let frameId: number | null = null

    const applyAccentColor = (color: string) => {
      document.documentElement.style.setProperty("--focus-ring", color)
    }

    applyAccentColor(usePreferencesStore.getState().accentColor)

    const unsubscribe = usePreferencesStore.subscribe((state, previousState) => {
      if (state.accentColor === previousState.accentColor) return

      if (frameId !== null) window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        applyAccentColor(usePreferencesStore.getState().accentColor)
        frameId = null
      })
    })

    return () => {
      unsubscribe()
      if (frameId !== null) window.cancelAnimationFrame(frameId)
    }
  }, [])

  return children
}

export { AccentColorProvider, useAccentColorContext }
