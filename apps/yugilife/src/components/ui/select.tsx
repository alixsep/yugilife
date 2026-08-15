/* eslint-disable react-refresh/only-export-components */
"use client"

import {
  Children,
  createContext,
  forwardRef,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { Select as SelectPrimitive } from "@base-ui/react/select"
import { cva } from "class-variance-authority"
import { AnimatePresence, motion } from "framer-motion"
import { ChevronDown } from "lucide-react"

import { useProximityHover } from "@/hooks/use-proximity-hover"
import { Elevated } from "@/lib/elevated"
import { useShape } from "@/lib/shape-context"
import { SizeProvider, useSize } from "@/lib/size-context"
import { exitFallbackMs, spring } from "@/lib/springs"
import { cn } from "@/lib/utils"

import { useFieldContext } from "./field-context"

import type { IconComponent } from "@/lib/icon-context"
import type { SizeVariant } from "@/lib/size-context"
import type { VariantProps } from "class-variance-authority"
import type { HTMLAttributes, ReactNode } from "react"

// ---------------------------------------------------------------------------
// Select context
//
// Built on Base UI Select, which owns positioning (collision flipping, anchor
// tracking), dismissal (outside press, Escape), list keyboard navigation +
// typeahead, combobox ARIA, and the hidden native select for forms.
// This layer keeps the proximity-hover overlays, the
// spring open/close animation, and the animated checkmark.
//
// Base UI-specific notes:
//
// - Value/placeholder: Base UI uses null for no selection, so the root maps
//   our public empty string to null while keeping the public API string-based.
//
// - Initial label: Base UI renders popup items only while open. The root
//   therefore supplies an `items` list so the trigger can resolve the label
//   before the popup mounts.
//
// - Exit animation: Base UI exposes `actionsRef.unmount()`, which lets the
//   popup stay mounted through the exit tween.
//
// ---------------------------------------------------------------------------

// How long a selection holds the popup open before closing, so the
// acknowledgment — the checkmark drawing in and the selected background
// springing to the picked row — is visible instead of being cut off by the
// ~60ms close fade. Escape and outside presses still close immediately.
const selectionAckMs = 300

interface SelectContextValue {
  value: string
  open: boolean
  actionsRef: React.RefObject<{ unmount: () => void } | null>
}

const SelectContext = createContext<SelectContextValue | null>(null)

function useSelectContext() {
  const ctx = useContext(SelectContext)
  if (!ctx) throw new Error("Select compound components must be inside <Select>")
  return ctx
}

// Content context for proximity hover
interface SelectContentContextValue {
  registerItem: (index: number, element: HTMLElement | null) => void
  activeIndex: number | null
  checkedIndex: number | undefined
}

const SelectContentContext = createContext<SelectContentContextValue | null>(null)

/** Collect the labels Base UI needs before the popup has mounted. */
function collectSelectItems(node: ReactNode, out: { value: string; label: ReactNode }[] = []) {
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return
    const props = child.props as { value?: unknown; children?: ReactNode }
    if (typeof props.value === "string") {
      out.push({
        value: props.value,
        label: typeof props.children === "string" ? props.children : props.value,
      })
    } else if (props.children) {
      collectSelectItems(props.children, out)
    }
  })
  return out
}

// ---------------------------------------------------------------------------
// Select (root)
// ---------------------------------------------------------------------------

interface SelectProps {
  children: ReactNode
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  disabled?: boolean
  name?: string
  required?: boolean
  /** Pins trigger and popup to one step of the size ladder (default 36px,
   *  compact 28px — see /docs/sizes). Omitted, both follow the surrounding
   *  SizeProvider. */
  size?: SizeVariant
}

function Select({
  children,
  value,
  defaultValue,
  onValueChange,
  disabled = false,
  name,
  required,
  size,
}: SelectProps) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? "")
  // Visual open state — flips immediately so exit springs start at once.
  const [open, setOpen] = useState(false)
  const currentValue = value !== undefined ? value : internalValue
  const actionsRef = useRef<{ unmount: () => void } | null>(null)
  const items = useMemo(() => collectSelectItems(children), [children])

  const ackTimeoutRef = useRef<number | null>(null)
  const cancelAckClose = useCallback(() => {
    if (ackTimeoutRef.current !== null) {
      clearTimeout(ackTimeoutRef.current)
      ackTimeoutRef.current = null
    }
  }, [])
  useEffect(() => cancelAckClose, [cancelAckClose])

  const handleValueChange = useCallback(
    (next: string | null) => {
      const nextValue = next ?? ""
      if (value === undefined) setInternalValue(nextValue)
      onValueChange?.(nextValue)
    },
    [value, onValueChange],
  )

  // Picking an item acknowledges before closing: the close is deferred by
  // selectionAckMs so the checkmark draw and the selected background's spring
  // to the picked row are seen. Base UI reports the close reason, so only an
  // item press receives the delayed acknowledgment; every other close
  // (Escape, outside press, trigger toggle, focus-out) is immediate.
  const handleOpenChange = useCallback(
    (nextOpen: boolean, eventDetails: { reason: string }) => {
      if (!nextOpen && eventDetails.reason === "item-press") {
        cancelAckClose()
        ackTimeoutRef.current = window.setTimeout(() => {
          ackTimeoutRef.current = null
          setOpen(false)
        }, selectionAckMs)
        return
      }
      cancelAckClose()
      setOpen(nextOpen)
    },
    [cancelAckClose],
  )

  const ctx = useMemo(() => ({ value: currentValue, open, actionsRef }), [currentValue, open])

  // A size prop pins the whole compound (trigger + portalled popup — React
  // context crosses portals) to one step of the ladder.
  const root = (
    <SelectContext.Provider value={ctx}>
      <SelectPrimitive.Root
        value={currentValue === "" ? null : currentValue}
        onValueChange={handleValueChange}
        open={open}
        onOpenChange={handleOpenChange}
        actionsRef={actionsRef}
        items={items}
        disabled={disabled}
        modal={false}
        {...(name === undefined ? {} : { name })}
        {...(required === undefined ? {} : { required })}
      >
        {children}
      </SelectPrimitive.Root>
    </SelectContext.Provider>
  )

  return size ? <SizeProvider size={size}>{root}</SizeProvider> : root
}

Select.displayName = "Select"

// ---------------------------------------------------------------------------
// SelectTrigger
// ---------------------------------------------------------------------------

const triggerVariants = cva(
  [
    "group inline-flex items-center justify-between outline-none cursor-pointer",
    "ring-1 ring-transparent transition-all duration-80",
    "disabled:opacity-50 disabled:pointer-events-none",
    "focus-visible:ring-(--focus-ring)",
  ],
  {
    variants: {
      variant: {
        bordered: "border border-border bg-transparent text-foreground hover:bg-hover",
        borderless: "border border-transparent bg-transparent text-foreground hover:bg-hover",
      },
    },
    defaultVariants: {
      variant: "bordered",
    },
  },
)

interface SelectTriggerProps
  extends
    Omit<HTMLAttributes<HTMLButtonElement>, "children">,
    VariantProps<typeof triggerVariants> {
  icon?: IconComponent
  placeholder?: string
  error?: string
  "data-cursor"?: "button" | "text" | "drag" | "default"
  /** Size override for the trigger alone. Prefer the `size` prop on <Select>
   *  (or a surrounding SizeProvider) so the popup matches. */
  size?: SizeVariant
}

const SelectTrigger = forwardRef<HTMLButtonElement, SelectTriggerProps>(
  (
    {
      className,
      variant,
      icon: Icon,
      id,
      placeholder = "Select…",
      error,
      size,
      "data-cursor": cursorMode,
      ...props
    },
    ref,
  ) => {
    const shape = useShape()
    const sizeClasses = useSize(size)
    const field = useFieldContext()

    return (
      <div className="flex max-w-full min-w-0 flex-col gap-1">
        <SelectPrimitive.Trigger
          ref={ref}
          id={id ?? field?.controlId}
          aria-invalid={!!error || undefined}
          className={cn(
            triggerVariants({ variant }),
            sizeClasses.control,
            sizeClasses.text,
            sizeClasses.px,
            sizeClasses.gap,
            "w-full max-w-full min-w-0",
            shape.input,
            error && "border-destructive/50 hover:border-destructive/50",
            className,
          )}
          {...props}
          data-cursor={cursorMode ?? "button"}
        >
          <span className={cn("flex min-w-0 flex-1 items-center", sizeClasses.gap)}>
            {Icon && (
              <Icon
                size={sizeClasses.icon}
                strokeWidth={1.5}
                className="text-muted-foreground group-hover:text-foreground shrink-0 transition-[color,stroke-width] duration-80 group-hover:stroke-2"
              />
            )}
            {/* py-1/-my-1 keeps truncate's overflow:hidden from clipping
                ascenders/descenders outside the trimmed box. */}
            <SelectPrimitive.Value
              placeholder={placeholder}
              className="data-placeholder:text-muted-foreground -my-1 min-w-0 flex-1 truncate py-1 text-left [text-box:trim-both_cap_alphabetic]"
            />
          </span>

          <ChevronDown
            className="text-muted-foreground group-hover:text-foreground shrink-0 transition-colors duration-80"
            size={sizeClasses.icon}
            strokeWidth={2}
          />
        </SelectPrimitive.Trigger>
        {error && <span className={cn("text-destructive pl-3", sizeClasses.caption)}>{error}</span>}
      </div>
    )
  },
)

SelectTrigger.displayName = "SelectTrigger"

// ---------------------------------------------------------------------------
// SelectContent
// ---------------------------------------------------------------------------

interface SelectContentProps {
  className?: string
  children: ReactNode
}

const SelectContent = forwardRef<HTMLDivElement, SelectContentProps>(
  ({ className, children }, ref) => {
    const { open, value, actionsRef } = useSelectContext()
    const shape = useShape()
    const containerRef = useRef<HTMLDivElement>(null)

    const {
      activeIndex,
      setActiveIndex,
      itemRects,
      isMeasured,
      sessionId,
      handlers,
      registerItem,
      remeasure,
    } = useProximityHover(containerRef)

    const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
    const [checkedIndex, setCheckedIndex] = useState<number | undefined>(undefined)

    // Release Base UI's deferred unmount once the exit tween has played.
    // onAnimationComplete on the motion.div is the primary signal; this
    // timeout is a fallback for throttled/background tabs where rAF-driven
    // animation callbacks can stall. The popup exits with spring.fast, so the
    // fallback tracks that tier's exit duration plus a safety buffer.
    useEffect(() => {
      if (open) return
      const id = setTimeout(() => actionsRef.current?.unmount(), exitFallbackMs(spring.fast))
      return () => clearTimeout(id)
    }, [open, actionsRef])

    // Fresh rects once per open. Measuring is the hook's job — it owns the
    // one coalesced pass that item registration and container resizes both
    // feed into, and a second pass from elsewhere is what used to land a
    // corrected rect on an already-mounted overlay. The popup keeps its items
    // registered while it sits hidden between opens, so registration alone
    // would never trigger a fresh pass on reopen.
    useEffect(() => {
      if (!open) return
      remeasure()
    }, [open, remeasure])

    // Detect the checked row. Deliberately does NOT remeasure on a value
    // change while open: the rows haven't moved, so the published rects stay
    // trustworthy and only checkedIndex switches — which lets the selected
    // marker spring from the old row to the picked one (the selection
    // acknowledgment) instead of unmounting and snapping.
    useEffect(() => {
      if (!open) return
      // Double rAF: first waits for React commit, second for layout
      let inner: number
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => {
          const container = containerRef.current
          if (container) {
            const items = Array.from(container.querySelectorAll("[data-proximity-index]"))
            const idx = items.findIndex((el) => el.getAttribute("data-value") === value)
            setCheckedIndex(idx !== -1 ? idx : undefined)
          }
        })
      })
      return () => {
        cancelAnimationFrame(outer)
        cancelAnimationFrame(inner)
      }
    }, [open, value])

    // Reset every overlay index when the close animation starts. checkedIndex
    // otherwise lags one open behind value (picking an item closes the popup
    // before the effect above re-syncs it), and a leftover activeIndex is worse:
    // the popup stays mounted through the exit tween, so on reopen the hover
    // pill would still be sitting on the previously active row and spring from
    // there to the row that auto-focus lands on.
    const resetOverlayState = () => {
      setCheckedIndex(undefined)
      setActiveIndex(null)
      setFocusedIndex(null)
    }

    // Overlays read rects only once the hook reports the item set fully
    // measured. Positioning one from an incomplete pass mounts it at the wrong
    // row, and the correcting pass then springs it across the list.
    const activeRect = isMeasured && activeIndex !== null ? itemRects[activeIndex] : null
    const checkedRect = isMeasured && checkedIndex != null ? itemRects[checkedIndex] : null
    const focusRect = isMeasured && focusedIndex !== null ? itemRects[focusedIndex] : null

    const contentCtx = useMemo(
      () => ({ registerItem, activeIndex, checkedIndex }),
      [registerItem, activeIndex, checkedIndex],
    )

    // Base UI keeps the popup mounted while the exit animation plays.
    return (
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          alignItemWithTrigger={false}
          className="z-50 outline-none"
        >
          <motion.div
            initial={{ opacity: 0, y: -4, scaleY: 0.96 }}
            animate={open ? { opacity: 1, y: 0, scaleY: 1 } : { opacity: 0, y: -4, scaleY: 0.96 }}
            transition={open ? spring.fast : spring.fast.exit}
            style={{ transformOrigin: "top center" }}
            onAnimationStart={() => {
              if (!open) resetOverlayState()
            }}
            onAnimationComplete={() => {
              if (!open) actionsRef.current?.unmount()
            }}
          >
            <SelectContentContext.Provider value={contentCtx}>
              {/* The popup is the scroll container and the offsetParent the
                  proximity overlay rects anchor to. */}
              <SelectPrimitive.Popup
                render={
                  <Elevated
                    offset={2}
                    shadowLevel={3}
                    ref={(node: HTMLDivElement | null) => {
                      containerRef.current = node
                      if (typeof ref === "function") ref(node)
                      else if (ref) ref.current = node
                    }}
                  />
                }
                onMouseEnter={() => {
                  handlers.onMouseEnter()
                  setFocusedIndex(null)
                }}
                onMouseMove={handlers.onMouseMove}
                onMouseLeave={handlers.onMouseLeave}
                onFocus={(e) => {
                  const indexAttr = (e.target as HTMLElement)
                    .closest("[data-proximity-index]")
                    ?.getAttribute("data-proximity-index")
                  if (indexAttr != null) {
                    const idx = Number(indexAttr)
                    setActiveIndex(idx)
                    setFocusedIndex(
                      (e.target as HTMLElement).matches(":focus-visible") ? idx : null,
                    )
                  }
                }}
                onBlur={(e) => {
                  if (containerRef.current?.contains(e.relatedTarget)) return
                  setFocusedIndex(null)
                  setActiveIndex(null)
                }}
                className={cn(
                  // min-w tracks the trigger via Base UI's Positioner.
                  `relative flex max-h-[min(300px,var(--available-height))] min-w-(--anchor-width) flex-col gap-0.5 overflow-y-auto ${shape.container} p-1 outline-none select-none`,
                  className,
                )}
              >
                {/* The three overlays are torn down as the close begins rather
                    than exit-animated, because an overlay still mounted when the
                    popup reopens is one AnimatePresence re-adopts under its old
                    key: `initial` never runs again, so it keeps the position of the
                    row it had before and animates from there to the new one. The
                    popup's own fade covers their disappearance. */}
                {/* Selected background */}
                {open && (
                  <AnimatePresence>
                    {checkedRect && (
                      <motion.div
                        className={`absolute ${shape.bg} bg-active pointer-events-none`}
                        // Position lives in `animate` so an in-session value
                        // change springs the marker to the picked row (the
                        // selection acknowledgment). Safe against the reopen
                        // slide: the `open &&` teardown means no marker
                        // survives a close, and a fresh mount with
                        // initial={false} renders snapped at these values.
                        initial={false}
                        animate={{
                          top: checkedRect.top,
                          left: checkedRect.left,
                          width: checkedRect.width,
                          height: checkedRect.height,
                          opacity: 1,
                        }}
                        exit={{ opacity: 0, transition: spring.moderate.exit }}
                        transition={{
                          ...spring.moderate,
                          opacity: { duration: 0.08 },
                        }}
                      />
                    )}
                  </AnimatePresence>
                )}
                {/* Hover background */}
                {open && (
                  <AnimatePresence>
                    {activeRect && (
                      <motion.div
                        key={sessionId}
                        className={`absolute ${shape.bg} bg-hover pointer-events-none`}
                        initial={{
                          opacity: 0,
                          top: activeRect.top,
                          left: activeRect.left,
                          width: activeRect.width,
                          height: activeRect.height,
                        }}
                        animate={{
                          opacity: 1,
                          top: activeRect.top,
                          left: activeRect.left,
                          width: activeRect.width,
                          height: activeRect.height,
                        }}
                        exit={{ opacity: 0, transition: spring.fast.exit }}
                        transition={{
                          ...spring.fast,
                          opacity: { duration: 0.08 },
                        }}
                      />
                    )}
                  </AnimatePresence>
                )}
                {/* Focus ring */}
                {open && (
                  <AnimatePresence>
                    {focusRect && (
                      <motion.div
                        className={`absolute ${shape.focusRing} pointer-events-none z-20 border border-(--focus-ring)`}
                        initial={false}
                        animate={{
                          left: focusRect.left - 2,
                          top: focusRect.top - 2,
                          width: focusRect.width + 4,
                          height: focusRect.height + 4,
                        }}
                        exit={{ opacity: 0, transition: spring.fast.exit }}
                        transition={{
                          ...spring.fast,
                          opacity: { duration: 0.08 },
                        }}
                      />
                    )}
                  </AnimatePresence>
                )}
                {children}
              </SelectPrimitive.Popup>
            </SelectContentContext.Provider>
          </motion.div>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    )
  },
)

SelectContent.displayName = "SelectContent"

// ---------------------------------------------------------------------------
// SelectItem
// ---------------------------------------------------------------------------

interface SelectItemProps extends HTMLAttributes<HTMLDivElement> {
  icon?: IconComponent
  index: number
  value: string
  disabled?: boolean
}

const SelectItem = forwardRef<HTMLDivElement, SelectItemProps>(
  ({ className, children, icon: Icon, value, index, disabled = false, ...props }, ref) => {
    const selectCtx = useSelectContext()
    const contentCtx = useContext(SelectContentContext)
    const internalRef = useRef<HTMLDivElement>(null)
    const shape = useShape()
    const sizeClasses = useSize()
    const compact = sizeClasses.variant === "compact"

    // Register with proximity hover. Depends on the (stable) registerItem
    // rather than the content context, which is rebuilt on every activeIndex
    // change: keying the effect to the whole context re-ran it per mousemove,
    // unregistering and re-registering every row and so keeping the hook's
    // measurement permanently unsettled while the pointer moved.
    const registerItem = contentCtx?.registerItem
    useEffect(() => {
      if (!registerItem) return
      registerItem(index, internalRef.current)
      return () => registerItem(index, null)
    }, [index, registerItem])

    const isActive = contentCtx?.activeIndex === index
    const isChecked = selectCtx.value === value

    return (
      <SelectPrimitive.Item
        value={value}
        disabled={disabled}
        {...(typeof children === "string" ? { label: children } : {})}
        render={
          <div
            ref={(node: HTMLDivElement | null) => {
              internalRef.current = node
              if (typeof ref === "function") ref(node)
              else if (ref) ref.current = node
            }}
            data-proximity-index={index}
            data-value={value}
            className={cn(
              // Fixed height (was py-2 around a 19.5px line box ≈ 35.5px) so
              // the text-box trim on the item text doesn't shrink the row.
              // shrink-0: the popup is a max-height flex column, so without it
              // a long list compresses rows to fit instead of scrolling.
              `relative z-10 flex ${sizeClasses.control} shrink-0 items-center ${sizeClasses.gap} ${shape.item} ${sizeClasses.itemPx} ${sizeClasses.text} cursor-pointer outline-none select-none`,
              "transition-[color] duration-80",
              isActive || isChecked ? "text-foreground" : "text-muted-foreground",
              disabled && "pointer-events-none opacity-50",
              className,
            )}
            {...props}
          />
        }
      >
        {Icon && (
          <Icon
            size={sizeClasses.icon}
            strokeWidth={isActive || isChecked ? 2 : 1.5}
            className="shrink-0 transition-[color,stroke-width] duration-80"
          />
        )}

        {/* py-1/-my-1 keeps truncate's overflow:hidden from clipping
            ascenders/descenders outside the trimmed box. */}
        <SelectPrimitive.ItemText
          render={
            <span className="-my-1 min-w-0 flex-1 truncate py-1 [text-box:trim-both_cap_alphabetic]" />
          }
        >
          {children}
        </SelectPrimitive.ItemText>

        {/* Always-rendered fixed slot so the check appearing/disappearing
            never changes the row's intrinsic width — without it the whole
            popup resizes when a selection lands. */}
        <span aria-hidden className={cn("shrink-0", compact ? "h-3.5 w-3.5" : "h-4 w-4")}>
          <AnimatePresence initial={false}>
            {isChecked && (
              <motion.svg
                key="check"
                width={sizeClasses.icon}
                height={sizeClasses.icon}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-foreground"
                initial={{ opacity: 1 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 1 }}
              >
                <motion.path
                  d="M4 12L9 17L20 6"
                  initial={{ pathLength: 0 }}
                  animate={{
                    pathLength: 1,
                    transition: { duration: 0.08, ease: "easeOut" },
                  }}
                  exit={{
                    pathLength: 0,
                    transition: { duration: 0.04, ease: "easeIn" },
                  }}
                />
              </motion.svg>
            )}
          </AnimatePresence>
        </span>
      </SelectPrimitive.Item>
    )
  },
)

SelectItem.displayName = "SelectItem"

// ---------------------------------------------------------------------------
// SelectGroup + SelectLabel + SelectSeparator
//
// Plain presentational divs. Keeping labels and separators independent of the
// primitive lets callers use them without requiring a specific group shape.
// ---------------------------------------------------------------------------

function SelectGroup({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div role="group" className={className} {...props}>
      {children}
    </div>
  )
}

SelectGroup.displayName = "SelectGroup"

const SelectLabel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    // Group labels are the caption role of the type scale — see /docs/sizes.
    const sizeClasses = useSize()
    return (
      <div
        ref={ref}
        className={cn("text-muted-foreground shrink-0 px-2 py-1.5", sizeClasses.caption, className)}
        {...props}
      />
    )
  },
)

SelectLabel.displayName = "SelectLabel"

const SelectSeparator = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="separator"
      className={cn("bg-border/60 -mx-1 my-1 h-px shrink-0", className)}
      {...props}
    />
  ),
)

SelectSeparator.displayName = "SelectSeparator"

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  triggerVariants,
}

export type { SelectContentProps, SelectItemProps, SelectProps, SelectTriggerProps }
