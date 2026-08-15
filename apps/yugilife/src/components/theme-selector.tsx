import { Monitor, Moon, Sun } from "lucide-react"

import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { useThemeContext } from "@/lib/theme-context"

import type { Theme } from "@/lib/theme-context"

const themeIcons: Record<Theme, typeof Monitor> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
}

const themeOptions = [
  { label: "System", value: "system" as Theme, icon: Monitor },
  { label: "Light", value: "light" as Theme, icon: Sun },
  { label: "Dark", value: "dark" as Theme, icon: Moon },
]

export function ThemeSelector() {
  const { theme, setTheme } = useThemeContext()
  const ThemeIcon = themeIcons[theme]

  const handleThemeChange = (next: string) => {
    const option = themeOptions.find((candidate) => candidate.value === next)
    if (option) setTheme(option.value)
  }

  return (
    <Select value={theme} onValueChange={handleThemeChange}>
      <SelectTrigger
        variant="borderless"
        className="w-auto min-w-0"
        icon={ThemeIcon}
        placeholder="Theme"
      />
      <SelectContent>
        {themeOptions.map((option, index) => (
          <SelectItem key={option.value} index={index} value={option.value} icon={option.icon}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
