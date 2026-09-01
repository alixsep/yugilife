const forcedFocusAttribute = "data-yugilife-forced-focus"

const editableControlSelector = [
  'input:not([type="hidden"]):not([disabled]):not([aria-hidden="true"]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([aria-hidden="true"]):not([tabindex="-1"])',
].join(",")

const primaryControlSelectors = [
  editableControlSelector,
  '[role="combobox"]:not([aria-disabled="true"])',
  "button:not([disabled])",
  '[tabindex]:not([tabindex="-1"]):not([aria-disabled="true"])',
] as const

function forceFocusRingForSession(control: HTMLElement) {
  if (control.matches(":focus-visible")) return
  control.setAttribute(forcedFocusAttribute, "")
  control.addEventListener(
    "blur",
    () => {
      control.removeAttribute(forcedFocusAttribute)
    },
    { once: true },
  )
}

function focusControl(control: HTMLElement | null) {
  if (!control) return false
  control.focus({ focusVisible: true, preventScroll: true })
  if (document.activeElement !== control) return false
  forceFocusRingForSession(control)
  return true
}

/** Focuses the field's primary editing surface and makes mouse-initiated editor focus visible. */
export function focusPrimaryCardFieldControl(container: HTMLElement, controlIndex?: number) {
  if (controlIndex !== undefined) {
    return focusControl(
      container.querySelectorAll<HTMLElement>(editableControlSelector).item(controlIndex),
    )
  }
  const visited = new Set<HTMLElement>()
  for (const selector of primaryControlSelectors) {
    const control = container.querySelector<HTMLElement>(selector)
    if (!control || visited.has(control)) continue
    visited.add(control)
    if (focusControl(control)) return true
  }
  return false
}
