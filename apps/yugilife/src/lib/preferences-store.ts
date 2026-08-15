import { create } from "zustand"

export type Theme = "system" | "light" | "dark"

export const DEFAULT_ACCENT_COLOR = "#65D48A"

const THEME_STORAGE_KEY = "yugilife-theme"
const ACCENT_COLOR_STORAGE_KEY = "yugilife-focus-ring-color"
const PREFERENCES_STORAGE_KEY = "yugilife-preferences"

interface PersistedPreferences {
  theme: Theme
  accentColor: string
}

interface PreferencesState extends PersistedPreferences {
  setTheme: (theme: Theme) => void
  setAccentColor: (color: string) => void
}

function isTheme(value: unknown): value is Theme {
  return value === "system" || value === "light" || value === "dark"
}

function isCssColor(value: string) {
  if (!value.trim()) return false
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") {
    return /^#[0-9a-f]{3,8}$/i.test(value)
  }
  return CSS.supports("color", value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function validAccentColor(value: unknown, fallback: string) {
  return typeof value === "string" && isCssColor(value) ? value : fallback
}

function readPreferences(): PersistedPreferences {
  const defaults = { theme: "dark" as Theme, accentColor: DEFAULT_ACCENT_COLOR }
  if (typeof window === "undefined") return defaults

  try {
    const storedPreferences = window.localStorage.getItem(PREFERENCES_STORAGE_KEY)
    if (storedPreferences) {
      const parsed: unknown = JSON.parse(storedPreferences)
      const state = isRecord(parsed) && isRecord(parsed.state) ? parsed.state : parsed

      if (isRecord(state)) {
        return {
          theme: isTheme(state.theme) ? state.theme : defaults.theme,
          accentColor: validAccentColor(state.accentColor, defaults.accentColor),
        }
      }
    }

    // Migrate the two keys used before the Zustand store existed.
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
    const storedAccentColor = window.localStorage.getItem(ACCENT_COLOR_STORAGE_KEY)

    return {
      theme: isTheme(storedTheme) ? storedTheme : defaults.theme,
      accentColor: validAccentColor(storedAccentColor, defaults.accentColor),
    }
  } catch {
    return defaults
  }
}

let pendingPreferences: PersistedPreferences | null = null
let persistTimer: number | null = null
let pageHideListenerAttached = false

function flushPreferences() {
  if (pendingPreferences === null || typeof window === "undefined") return

  if (persistTimer !== null) {
    window.clearTimeout(persistTimer)
    persistTimer = null
  }

  try {
    window.localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({ state: pendingPreferences, version: 0 }),
    )
  } catch {
    // Storage can be unavailable in private browsing or when quota is full.
  }

  pendingPreferences = null
}

function schedulePreferencesPersist(state: PersistedPreferences) {
  if (typeof window === "undefined") return

  pendingPreferences = state

  if (!pageHideListenerAttached) {
    window.addEventListener("pagehide", flushPreferences)
    pageHideListenerAttached = true
  }

  if (persistTimer !== null) window.clearTimeout(persistTimer)
  persistTimer = window.setTimeout(flushPreferences, 100)
}

const initialPreferences = readPreferences()

export const usePreferencesStore = create<PreferencesState>()((set, get) => ({
  ...initialPreferences,
  setTheme: (theme) => {
    if (get().theme === theme) return
    set({ theme })
    schedulePreferencesPersist({
      theme,
      accentColor: get().accentColor,
    })
  },
  setAccentColor: (color) => {
    if (!isCssColor(color) || get().accentColor === color) return
    set({ accentColor: color })
    schedulePreferencesPersist({
      theme: get().theme,
      accentColor: color,
    })
  },
}))
