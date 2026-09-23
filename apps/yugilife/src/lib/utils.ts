import { clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

import type { ClassValue } from "clsx"

/**
 * The surface ladder's `shadow-surface-*` utilities are shadows, not shadow colours.
 *
 * `shadow-surface-1` looks like `shadow-red-500` to tailwind-merge, so it lands in the shadow-colour
 * group and stops conflicting with the shadows it replaces. `shadow-none` next to it then leaves
 * both standing, and in dark mode the ladder's low steps are an inset 1px ring — so the shadow that
 * was supposed to be gone stays on as a hairline border.
 */
const surfaceShadows = [1, 2, 3, 4, 5, 6, 7, 8].map((level) => `shadow-surface-${level}`)

/**
 * The app's type-scale roles are `text-*` utilities that set a size, not a colour.
 *
 * tailwind-merge has no way to know that: it sees `text-caption` next to `text-foreground`, assumes
 * both are colours, and drops the earlier one. The size then disappears with no error and no
 * warning, and the element quietly inherits whatever its parent was set in. Registering the roles
 * in the font-size group makes them conflict with each other and with `text-[13px]`, which is what
 * they actually are, and stop conflicting with colours.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": ["text-display", "text-title", "text-subtitle", "text-body", "text-caption"],
      shadow: surfaceShadows,
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
