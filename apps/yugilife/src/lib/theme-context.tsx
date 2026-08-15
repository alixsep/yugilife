/* eslint-disable react-refresh/only-export-components */

import { useLayoutEffect } from "react"

import { runAppearanceTransition } from "./appearance-transition"
import { usePreferencesStore } from "./preferences-store"

import type { Theme } from "./preferences-store"
import type { ReactNode } from "react"

function useThemeContext() {
  const theme = usePreferencesStore((state) => state.theme)
  const setTheme = usePreferencesStore((state) => state.setTheme)

  return { theme, setTheme }
}

function ThemeProvider({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    const root = document.documentElement

    const applyTheme = (theme: Theme) => {
      root.classList.remove("light", "dark")
      if (theme !== "system") root.classList.add(theme)
    }

    applyTheme(usePreferencesStore.getState().theme)

    const unsubscribe = usePreferencesStore.subscribe((state, previousState) => {
      if (state.theme === previousState.theme) return
      runAppearanceTransition(() => applyTheme(state.theme))
    })

    return unsubscribe
  }, [])

  return children
}

export { ThemeProvider, useThemeContext }
export type { Theme }
