import { useRef, useState } from "react"

import { Popover } from "@base-ui/react/popover"
import { motion } from "framer-motion"
import { CircleDot, Monitor, Moon, MousePointer, Settings, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ColorPicker } from "@/components/ui/color-picker"
import { Dropdown, DropdownLabel, DropdownSeparator } from "@/components/ui/dropdown"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { Tooltip } from "@/components/ui/tooltip"
import { useAccentColorContext } from "@/lib/accent-color-context"
import { DEFAULT_ACCENT_COLOR, usePreferencesStore } from "@/lib/preferences-store"
import { useSize } from "@/lib/size-context"
import { spring } from "@/lib/springs"
import { useThemeContext } from "@/lib/theme-context"

import type { CursorPreference } from "@/lib/preferences-store"
import type { Theme } from "@/lib/theme-context"

/** The accent presets, with the app's own colour first. */
const ACCENT_SWATCHES = [DEFAULT_ACCENT_COLOR, "#6B97FF", "#D66BFF", "#65D48A", "#F5C85B"]

const themeOptions = [
  { icon: Monitor, label: "System", value: "system" as Theme },
  { icon: Sun, label: "Light", value: "light" as Theme },
  { icon: Moon, label: "Dark", value: "dark" as Theme },
]

const cursorOptions = [
  { icon: CircleDot, label: "Custom", value: "custom" as CursorPreference },
  { icon: MousePointer, label: "Native", value: "native" as CursorPreference },
]

/**
 * Theme and accent under one trigger, so the header spends one slot on preferences most people set
 * once and keeps its shape at every width.
 *
 * The panel is a popover holding the inline `Dropdown`, not a menu: a menu owns the keyboard — its
 * typeahead would swallow what is typed into the picker's hex field — and closes on the first
 * selection, when trying themes against accents is the whole point of pairing them.
 */
export function AppearanceMenu() {
  const { accentColor, setAccentColor } = useAccentColorContext()
  const { setTheme, theme } = useThemeContext()
  const cursor = usePreferencesStore((state) => state.cursor)
  const setCursor = usePreferencesStore((state) => state.setCursor)
  const sizeClasses = useSize()
  const [open, setOpen] = useState(false)
  const actionsRef = useRef<{ close: () => void; unmount: () => void } | null>(null)

  return (
    <Popover.Root
      actionsRef={actionsRef}
      // Non-modal: the page behind stays live, so a theme or an accent can be judged against it
      // while the panel is still open.
      modal={false}
      onOpenChange={setOpen}
      open={open}
    >
      <Popover.Trigger
        render={
          <Tooltip content="Settings" side="bottom" sideOffset={10}>
            <Button aria-label="Settings" size="icon" variant="ghost">
              <Settings size={sizeClasses.icon} strokeWidth={1.5} />
            </Button>
          </Tooltip>
        }
      />
      <Popover.Portal>
        <Popover.Positioner align="end" className="z-50 outline-none" side="bottom" sideOffset={10}>
          <motion.div
            animate={open ? { opacity: 1, scaleY: 1, y: 0 } : { opacity: 0, scaleY: 0.96, y: -4 }}
            initial={{ opacity: 0, scaleY: 0.96, y: -4 }}
            // Base UI defers unmount while actionsRef is set; release it once the exit spring has
            // finished so the close animation fully plays.
            onAnimationComplete={() => {
              if (!open) actionsRef.current?.unmount()
            }}
            style={{ transformOrigin: "top right" }}
            transition={open ? spring.moderate : spring.moderate.exit}
          >
            <Popover.Popup className="outline-none">
              <Dropdown aria-label="Settings">
                <div className="flex items-center justify-between gap-2 px-2 py-1">
                  <span className={`text-muted-foreground ${sizeClasses.body}`}>Theme</span>
                  <Select onValueChange={(value) => setTheme(value as Theme)} value={theme}>
                    <SelectTrigger className="w-36" />
                    <SelectContent>
                      {themeOptions.map((option, index) => (
                        <SelectItem
                          icon={option.icon}
                          index={index}
                          key={option.value}
                          value={option.value}
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between gap-2 px-2 py-1">
                  <span className={`text-muted-foreground ${sizeClasses.body}`}>Cursor</span>
                  <Select
                    onValueChange={(value) => setCursor(value as CursorPreference)}
                    value={cursor}
                  >
                    <SelectTrigger className="w-36" />
                    <SelectContent>
                      {cursorOptions.map((option, index) => (
                        <SelectItem
                          icon={option.icon}
                          index={index}
                          key={option.value}
                          value={option.value}
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <DropdownSeparator />

                <DropdownLabel className={sizeClasses.body}>Accent</DropdownLabel>
                <ColorPicker
                  className="bg-transparent px-2 pt-1 pb-2 shadow-none"
                  defaultValue={DEFAULT_ACCENT_COLOR}
                  onValueChange={setAccentColor}
                  swatches={ACCENT_SWATCHES}
                  title=""
                  value={accentColor}
                />
              </Dropdown>
            </Popover.Popup>
          </motion.div>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
