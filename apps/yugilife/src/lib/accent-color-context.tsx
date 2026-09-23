/* eslint-disable react-refresh/only-export-components */

import { useLayoutEffect } from "react"

import { foregroundForCssColor } from "./color-contrast"
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
      const root = document.documentElement
      const backdrop = getComputedStyle(document.body).backgroundColor
      root.style.setProperty("--user-accent", color)
      root.style.setProperty("--user-accent-foreground", foregroundForCssColor(color, backdrop))
    }

    const scheduleApply = () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        applyAccentColor(usePreferencesStore.getState().accentColor)
        frameId = null
      })
    }

    applyAccentColor(usePreferencesStore.getState().accentColor)

    const unsubscribe = usePreferencesStore.subscribe((state, previousState) => {
      if (state.accentColor === previousState.accentColor && state.theme === previousState.theme)
        return

      scheduleApply()
    })

    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
    const handleSystemThemeChange = () => {
      if (usePreferencesStore.getState().theme === "system") scheduleApply()
    }
    systemTheme.addEventListener("change", handleSystemThemeChange)

    return () => {
      unsubscribe()
      systemTheme.removeEventListener("change", handleSystemThemeChange)
      if (frameId !== null) window.cancelAnimationFrame(frameId)
    }
  }, [])

  return children
}

export { AccentColorProvider, useAccentColorContext }
