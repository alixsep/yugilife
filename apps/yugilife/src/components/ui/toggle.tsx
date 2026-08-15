import { forwardRef } from "react"

import { Button } from "./button"

import type { ButtonProps } from "./button"

interface ToggleProps extends Omit<ButtonProps, "active" | "aria-pressed" | "onClick"> {
  pressed: boolean
  onPressedChange: (pressed: boolean) => void
}

const Toggle = forwardRef<HTMLButtonElement, ToggleProps>(
  ({ onPressedChange, pressed, variant = "tertiary", ...props }, ref) => (
    <Button
      {...props}
      ref={ref}
      active={pressed}
      aria-pressed={pressed}
      type={props.type ?? "button"}
      variant={variant}
      onClick={() => onPressedChange(!pressed)}
    />
  ),
)

Toggle.displayName = "Toggle"

export { Toggle }
export type { ToggleProps }
