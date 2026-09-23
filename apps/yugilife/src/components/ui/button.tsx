/* eslint-disable react-refresh/only-export-components */

import { cloneElement, forwardRef, isValidElement } from "react"

import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority"

import { useShape } from "@/lib/shape-context"
import { useSize, useSizeVariant } from "@/lib/size-context"
import { cn } from "@/lib/utils"

import { LoadingSpinner } from "./loading-spinner"

import type { IconComponent } from "@/lib/icon-context"
import type { VariantProps } from "class-variance-authority"
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from "react"

const buttonVariants = cva(
  [
    // Control height is fixed by the size ladder, so the label must stay on one line: a wrapped
    // label overflows the button box rather than growing it. Keeping the label unwrapped also makes
    // the button's min-content width its full label width, so a tight flex row wraps the buttons
    // apart instead of crushing them.
    "group relative isolate inline-flex items-center justify-center whitespace-nowrap outline-none cursor-pointer",
    "ring-1 ring-transparent transition-[color,background-color,border-color,box-shadow] duration-80",
    "disabled:opacity-50 disabled:pointer-events-none",
    "focus-visible:ring-(--focus-ring)",
  ],
  {
    variants: {
      variant: {
        primary: "text-background",
        secondary: "text-foreground",
        tertiary: "text-foreground",
        ghost: "text-muted-foreground hover:text-foreground",
        // No surface at any state, so the label itself is the button's box: it aligns with body
        // copy and with the controls beneath it instead of sitting inside a padded hit area.
        text: "text-muted-foreground hover:text-foreground",
      },
      // The two-step size ladder shared by every control — see /docs/sizes.
      // default = 36px control height, compact = 28px for dense surfaces.
      size: {
        default: "h-9 px-4 gap-1.5",
        compact: "h-7 px-3 gap-1",
        icon: "h-9 w-9 p-0 [&_svg]:h-4 [&_svg]:w-4",
        "icon-compact": "h-7 w-7 p-0 [&_svg]:h-3.5 [&_svg]:w-3.5",
        // Off the height ladder on purpose: a tile is a target you aim at rather than a row you
        // read, so it is a square with its icon over its label.
        tile: "size-20 flex-col gap-1.5 p-2",
      },
      iconLeft: { true: "" },
      iconRight: { true: "" },
    },
    compoundVariants: [
      { size: "compact", iconLeft: true, className: "pl-[6px]" },
      { size: "default", iconLeft: true, className: "pl-[10px]" },
      { size: "compact", iconRight: true, className: "pr-[6px]" },
      { size: "default", iconRight: true, className: "pr-[10px]" },
      // Last, so it overrides the padding every size and icon pairing above sets.
      { variant: "text", className: "px-0" },
    ],
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
)

type ButtonSizeCanonical = "default" | "compact" | "icon" | "icon-compact" | "tile"
type CursorMode = "button" | "text" | "drag" | "default"

/** Public size values: the canonical two-size scale plus the pre-sizes-system
 *  aliases, kept so existing call sites keep compiling. Aliases resolve onto
 *  the canonical ladder (sm → compact; md/lg → default). */
type ButtonSize = ButtonSizeCanonical | "sm" | "md" | "lg" | "icon-sm" | "icon-lg"

const legacySizeAliases: Partial<Record<ButtonSize, ButtonSizeCanonical>> = {
  sm: "compact",
  md: "default",
  lg: "default",
  "icon-sm": "icon-compact",
  "icon-lg": "icon",
}

interface ButtonProps
  extends
    ButtonHTMLAttributes<HTMLButtonElement>,
    Omit<VariantProps<typeof buttonVariants>, "size"> {
  /** Omitted, the button follows the surrounding SizeProvider (default 36px,
   *  compact 28px). Legacy sm/md/lg values still resolve. */
  size?: ButtonSize
  asChild?: boolean
  loading?: boolean
  leadingIcon?: IconComponent
  trailingIcon?: IconComponent
  /** Force the visual pressed/held state. Useful when the button drives an
   *  external open piece of UI (a popover, dropdown, etc.) so it reads as
   *  engaged while the menu is showing. */
  active?: boolean
  "data-cursor"?: CursorMode
}

/* Press effect: the surface layer sits 1px inside the button and a
   same-color box-shadow spread fills it back out to the full bounds.
   Pressing collapses the spread, shrinking the surface by exactly 1px per
   side at any width — a scale would warp (2% of a 400px button is 8px
   sideways but under 1px vertically). Fill colors are opaque color-mix()es
   rather than alpha so the fill and its spread ring never seam. */
const bgVariants: Record<string, string> = {
  primary:
    "[--btn-bg:var(--foreground)] group-hover:[--btn-bg:color-mix(in_oklab,var(--foreground)_90%,var(--background))] group-active:[--btn-bg:color-mix(in_oklab,var(--foreground)_80%,var(--background))] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
  secondary:
    "[--btn-bg:var(--accent)] group-hover:[--btn-bg:color-mix(in_oklab,var(--accent)_80%,var(--background))] group-active:[--btn-bg:var(--accent)] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
  // The border ring is an outer 1px shadow at rest that hands off to an
  // inset 1px shadow when pressed, so the ring moves inward with the
  // surface. The translucent fill only ever reaches the ring's inner edge
  // (exactly the surface box), so it needs no spread of its own.
  tertiary:
    "bg-transparent shadow-[0_0_0_1px_var(--border),inset_0_0_0_0px_var(--border)] group-hover:bg-hover group-active:bg-active group-active:shadow-[0_0_0_0px_var(--border),inset_0_0_0_1px_var(--border)]",
  // Translucent fill + same-color spread never double up: outer shadows
  // render only outside the surface box.
  ghost:
    "bg-transparent shadow-[0_0_0_1px_transparent] group-hover:bg-hover group-hover:shadow-[0_0_0_1px_var(--hover)] group-active:bg-active group-active:shadow-[0_0_0_0px_var(--active)]",
  // The surface layer still renders for structure; it just never paints, and with no fill there is
  // nothing for the press-collapse to shrink. Hover and press read on the label's color alone.
  text: "bg-transparent shadow-none",
}

/* Forced-active (`active` prop): pressed colors at full size; the
   geometric press-collapse still reacts on top. */
const activeBgVariants: Record<string, string> = {
  primary:
    "[--btn-bg:color-mix(in_oklab,var(--foreground)_80%,var(--background))] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
  secondary:
    "[--btn-bg:var(--accent)] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
  tertiary:
    "bg-active shadow-[0_0_0_1px_var(--border),inset_0_0_0_0px_var(--border)] group-active:shadow-[0_0_0_0px_var(--border),inset_0_0_0_1px_var(--border)]",
  ghost: "bg-active shadow-[0_0_0_1px_var(--active)] group-active:shadow-[0_0_0_0px_var(--active)]",
  text: "bg-transparent shadow-none",
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      leadingIcon: LeadingIcon,
      trailingIcon: TrailingIcon,
      active = false,
      disabled,
      children,
      style,
      "data-cursor": cursorMode,
      ...props
    },
    ref,
  ) => {
    // asChild: the user's element becomes the root, but the button's internal
    // structure (bg layer, content wrapper, spinner, icons) must survive. Slot
    // requires exactly one child, so instead of Slottable we clone the user's
    // element with our internals as its children — the element's own children
    // become the label inside the content wrapper.
    const asChildElement =
      asChild && isValidElement(children)
        ? (children as ReactElement<{ children?: ReactNode }>)
        : null
    const Comp = asChildElement ? Slot : "button"
    const label = asChildElement ? asChildElement.props.children : children
    // Resolve the size: explicit prop (legacy aliases mapped onto the
    // canonical ladder) > surrounding SizeProvider > default.
    const contextSize = useSizeVariant()
    const resolvedSize: ButtonSizeCanonical = size
      ? (legacySizeAliases[size] ?? (size as ButtonSizeCanonical))
      : contextSize === "compact"
        ? "compact"
        : "default"
    const isIconOnly = resolvedSize === "icon" || resolvedSize === "icon-compact"
    const isCompact = resolvedSize === "compact" || resolvedSize === "icon-compact"
    const isTile = resolvedSize === "tile"
    const sizeClasses = useSize(isCompact ? "compact" : "default")
    const iconSize = isCompact ? 14 : isTile ? 20 : 16
    const shape = useShape()
    const bgClass = active
      ? activeBgVariants[variant ?? "primary"]
      : bgVariants[variant ?? "primary"]

    const internals = (
      <>
        <span
          aria-hidden
          className={cn(
            "absolute inset-px rounded-[inherit] transition-[box-shadow,background-color] duration-[180ms,80ms] ease-[cubic-bezier(0.23,1,0.32,1),ease] group-active:duration-[80ms,80ms]",
            bgClass,
          )}
        />
        <span
          className={cn(
            "relative inline-flex items-center justify-center gap-[inherit]",
            isTile && "flex-col",
          )}
        >
          {loading ? (
            <>
              <span className="flex items-center justify-center gap-[inherit] opacity-0">
                {LeadingIcon && !isIconOnly && <LeadingIcon size={iconSize} strokeWidth={2} />}
                {label}
                {TrailingIcon && !isIconOnly && <TrailingIcon size={iconSize} strokeWidth={2} />}
              </span>
              <span className="absolute inset-0 flex items-center justify-center">
                <LoadingSpinner size={isCompact ? "compact" : "default"} />
              </span>
            </>
          ) : isIconOnly ? (
            <span className="[&_svg]:stroke-[1.5] [&_svg]:transition-[stroke-width] [&_svg]:duration-80 group-hover:[&_svg]:stroke-2">
              {label}
            </span>
          ) : (
            <>
              {LeadingIcon && (
                <LeadingIcon
                  size={iconSize}
                  strokeWidth={1.5}
                  className="transition-[stroke-width] duration-80 group-hover:stroke-2"
                />
              )}
              {/* text-box only applies to block containers, so the trim lives
                  on the label span (a blockified flex item), not the flex root.
                  The button's height is fixed (h-*), so this doesn't change
                  layout — it just centers the cap-to-baseline box optically. */}
              <span className="[text-box:trim-both_cap_alphabetic]">{label}</span>
              {TrailingIcon && (
                <TrailingIcon
                  size={iconSize}
                  strokeWidth={1.5}
                  className="transition-[stroke-width] duration-80 group-hover:stroke-2"
                />
              )}
            </>
          )}
        </span>
      </>
    )

    return (
      <Comp
        ref={ref}
        className={cn(
          buttonVariants({
            variant,
            size: resolvedSize,
            iconLeft: !isIconOnly && !!LeadingIcon,
            iconRight: !isIconOnly && !!TrailingIcon,
          }),
          !isIconOnly && sizeClasses.body,
          shape.button,
          className,
        )}
        // asChild roots (e.g. an anchor) don't take the disabled attribute —
        // Slot would spread it onto the element as invalid HTML.
        disabled={asChildElement ? undefined : disabled || loading}
        style={style}
        {...props}
        data-cursor={cursorMode ?? "button"}
      >
        {asChildElement ? cloneElement(asChildElement, undefined, internals) : internals}
      </Comp>
    )
  },
)

Button.displayName = "Button"

export { Button, buttonVariants }
export type { ButtonProps, ButtonSize }
