import { createElement, forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { AnimatePresence, motion } from "framer-motion"

import { useProximityHover, useRegisterProximityItem } from "@/hooks/use-proximity-hover"
import { Elevated } from "@/lib/elevated"
import { useIcon } from "@/lib/icon-context"
import { useShape } from "@/lib/shape-context"
import { SizeProvider, useSize } from "@/lib/size-context"
import { exitFallbackMs, spring } from "@/lib/springs"
import { cn } from "@/lib/utils"

import { mergeIds, useFieldContext } from "./field-context"

import type { SizeVariant } from "@/lib/size-context"
import type { ComponentPropsWithoutRef, HTMLAttributes } from "react"

// Match Select's brief selection acknowledgment before an item-press closes
// the popup. Other close reasons remain immediate.
const selectionAckMs = 300

interface ComboboxOption<T> {
  value: T
  label: string
  disabled?: boolean
  keywords?: string[]
}

interface ComboboxInputChangeDetails {
  reason: string
}

interface ComboboxProps<T> extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "defaultValue" | "onChange"
> {
  defaultValue?: T | null
  disabled?: boolean
  emptyMessage?: string
  freeform?: boolean
  inputProps?: ComponentPropsWithoutRef<typeof ComboboxPrimitive.Input>
  inputValue?: string
  isItemEqual?: (item: T, value: T) => boolean
  itemKey?: (item: ComboboxOption<T>, index: number) => string
  items: readonly ComboboxOption<T>[]
  defaultOpen?: boolean
  onValueChange?: (value: T | null) => void
  onOpenChange?: (open: boolean) => void
  onInputValueChange?: (value: string, details: ComboboxInputChangeDetails) => void
  open?: boolean
  placeholder?: string
  size?: SizeVariant
  value?: T | null
}

interface ComboboxOptionItemProps<T> {
  activeIndex: number | null
  index: number
  item: ComboboxOption<T>
  registerItem: (index: number, element: HTMLElement | null) => void
}

function ComboboxOptionItem<T>({
  activeIndex,
  index,
  item,
  registerItem,
}: ComboboxOptionItemProps<T>) {
  const itemRef = useRef<HTMLDivElement>(null)
  const shape = useShape()
  const sizeClasses = useSize()
  const compact = sizeClasses.variant === "compact"
  const isActive = activeIndex === index

  useRegisterProximityItem(registerItem, index, itemRef)

  return (
    <ComboboxPrimitive.Item
      value={item}
      index={index}
      disabled={item.disabled}
      render={
        <div
          ref={itemRef}
          data-proximity-index={index}
          className={cn(
            `relative z-10 flex ${sizeClasses.control} shrink-0 items-center ${sizeClasses.gap} ${shape.item} ${sizeClasses.itemPx} ${sizeClasses.text} cursor-pointer outline-none select-none`,
            "data-highlighted:text-foreground transition-[color] duration-80",
            isActive ? "text-foreground" : "text-muted-foreground",
            "data-selected:text-foreground",
            "data-disabled:pointer-events-none data-disabled:opacity-50",
          )}
        />
      }
    >
      <span className="-my-1 min-w-0 flex-1 truncate py-1 [text-box:trim-both_cap_alphabetic]">
        {item.label}
      </span>
      <span aria-hidden className={cn("shrink-0", compact ? "size-3.5" : "size-4")}>
        <ComboboxPrimitive.ItemIndicator>
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
        </ComboboxPrimitive.ItemIndicator>
      </span>
    </ComboboxPrimitive.Item>
  )
}

function ComboboxInner<T>(
  {
    className,
    defaultOpen = false,
    defaultValue,
    disabled = false,
    emptyMessage = "No results found.",
    freeform = false,
    inputProps,
    inputValue,
    isItemEqual = Object.is,
    itemKey = (item, index) => `${index}-${item.label}`,
    items,
    onOpenChange,
    onInputValueChange,
    open: openProp,
    onValueChange,
    placeholder = "Search…",
    size,
    value,
    ...props
  }: ComboboxProps<T>,
  ref: React.ForwardedRef<HTMLDivElement>,
) {
  const field = useFieldContext()
  const shape = useShape()
  const sizeClasses = useSize(size)
  const ChevronDownIcon = useIcon("chevron-down")
  const isOpenControlled = openProp !== undefined
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const open = isOpenControlled ? openProp : internalOpen
  const [acknowledgingSelection, setAcknowledgingSelection] = useState(false)
  const actionsRef = useRef<{ unmount: () => void } | null>(null)
  const ackTimeoutRef = useRef<number | null>(null)
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
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const cancelAckClose = useCallback(() => {
    if (ackTimeoutRef.current !== null) {
      window.clearTimeout(ackTimeoutRef.current)
      ackTimeoutRef.current = null
    }
  }, [])

  useEffect(() => cancelAckClose, [cancelAckClose])

  const handleOpenChange = useCallback(
    (next: boolean, eventDetails: { reason: string }) => {
      if (!next && eventDetails.reason === "item-press") {
        cancelAckClose()
        setAcknowledgingSelection(true)
        ackTimeoutRef.current = window.setTimeout(() => {
          ackTimeoutRef.current = null
          if (!isOpenControlled) setInternalOpen(false)
          onOpenChange?.(false)
        }, selectionAckMs)
        return
      }

      cancelAckClose()
      setAcknowledgingSelection(false)
      if (!isOpenControlled) setInternalOpen(next)
      onOpenChange?.(next)
    },
    [cancelAckClose, isOpenControlled, onOpenChange],
  )

  useEffect(() => {
    if (open) return
    const timeout = window.setTimeout(
      () => actionsRef.current?.unmount(),
      exitFallbackMs(spring.fast),
    )
    return () => window.clearTimeout(timeout)
  }, [open])

  useEffect(() => {
    if (!open) return
    remeasure()
  }, [open, remeasure])

  useEffect(() => {
    if (!open) return
    let innerFrame: number | undefined
    const outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        const container = containerRef.current
        if (!container) return
        const items = Array.from(container.querySelectorAll<HTMLElement>("[data-proximity-index]"))
        const index = items.findIndex((element) => element.getAttribute("aria-selected") === "true")
        setSelectedIndex(index === -1 ? null : index)
      })
    })

    return () => {
      cancelAnimationFrame(outerFrame)
      if (innerFrame !== undefined) cancelAnimationFrame(innerFrame)
    }
  }, [open, value])

  const resetOverlayState = () => {
    setActiveIndex(null)
    setFocusedIndex(null)
    setSelectedIndex(null)
  }

  const activeRect = isMeasured && activeIndex !== null ? itemRects[activeIndex] : null
  const selectedRect = isMeasured && selectedIndex !== null ? itemRects[selectedIndex] : null
  const focusRect = isMeasured && focusedIndex !== null ? itemRects[focusedIndex] : null

  const selectedItem = useMemo(
    () => (value == null ? null : (items.find((item) => isItemEqual(item.value, value)) ?? null)),
    [isItemEqual, items, value],
  )
  const initialItem = useMemo(
    () =>
      defaultValue == null
        ? null
        : (items.find((item) => isItemEqual(item.value, defaultValue)) ?? null),
    [defaultValue, isItemEqual, items],
  )
  const inputId = inputProps?.id ?? field?.controlId
  const inputDescribedBy = mergeIds(
    inputProps?.["aria-describedby"],
    field?.descriptionId,
    field?.invalid ? field.errorId : undefined,
  )
  const resolvedDisabled = disabled || field?.disabled
  const resolvedInvalid = inputProps?.["aria-invalid"] ?? field?.invalid

  const selectionProps =
    value === undefined
      ? initialItem === null
        ? {}
        : { defaultValue: initialItem }
      : { value: selectedItem }

  const filterItems = (item: ComboboxOption<T>, query: string) => {
    if (acknowledgingSelection) return true
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) return true
    return [item.label, ...(item.keywords ?? [])].some((text) =>
      text.toLocaleLowerCase().includes(normalizedQuery),
    )
  }

  const content = (
    <>
      <div ref={ref} className={cn("relative", className)} {...props}>
        <ComboboxPrimitive.Input
          {...inputProps}
          id={inputId}
          placeholder={inputProps?.placeholder ?? placeholder}
          disabled={resolvedDisabled}
          aria-describedby={inputDescribedBy}
          aria-invalid={resolvedInvalid || undefined}
          className={cn(
            "border-border text-foreground placeholder:text-muted-foreground hover:border-border w-full border bg-transparent pr-9 ring-1 ring-transparent transition-[border-color,box-shadow] duration-80 outline-none focus:outline-none focus-visible:ring-(--focus-ring) focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
            sizeClasses.control,
            sizeClasses.px,
            sizeClasses.text,
            shape.input,
            inputProps?.className,
          )}
        />
        <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-2 flex items-center">
          {createElement(ChevronDownIcon, { size: sizeClasses.icon, strokeWidth: 1.5 })}
        </span>
      </div>

      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
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
            <ComboboxPrimitive.Popup
              render={
                <Elevated
                  offset={2}
                  shadowLevel={3}
                  ref={(node: HTMLDivElement | null) => {
                    containerRef.current = node
                  }}
                />
              }
              onMouseEnter={() => {
                handlers.onMouseEnter()
                setFocusedIndex(null)
              }}
              onMouseMove={handlers.onMouseMove}
              onMouseLeave={handlers.onMouseLeave}
              onFocus={(event) => {
                const indexAttr = (event.target as HTMLElement)
                  .closest("[data-proximity-index]")
                  ?.getAttribute("data-proximity-index")
                if (indexAttr != null) {
                  const index = Number(indexAttr)
                  setActiveIndex(index)
                  setFocusedIndex(
                    (event.target as HTMLElement).matches(":focus-visible") ? index : null,
                  )
                }
              }}
              onBlur={(event) => {
                if (containerRef.current?.contains(event.relatedTarget)) return
                setFocusedIndex(null)
                setActiveIndex(null)
              }}
              className={cn(
                "relative flex max-h-[min(300px,var(--available-height))] min-w-(--anchor-width) flex-col overflow-y-auto overscroll-contain p-1 outline-none select-none",
                shape.container,
              )}
            >
              {open && (
                <AnimatePresence>
                  {selectedRect && (
                    <motion.div
                      className={`pointer-events-none absolute ${shape.bg} bg-active`}
                      initial={false}
                      animate={{
                        top: selectedRect.top,
                        left: selectedRect.left,
                        width: selectedRect.width,
                        height: selectedRect.height,
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
              {open && (
                <AnimatePresence>
                  {activeRect && (
                    <motion.div
                      key={sessionId}
                      className={`pointer-events-none absolute ${shape.bg} bg-hover`}
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
              {open && (
                <AnimatePresence>
                  {focusRect && (
                    <motion.div
                      className={`pointer-events-none absolute z-20 ${shape.focusRing} border border-(--focus-ring)`}
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
              <ComboboxPrimitive.Empty
                className={cn(
                  "text-muted-foreground px-2 py-2 empty:h-0 empty:overflow-hidden empty:p-0",
                  sizeClasses.body,
                )}
              >
                {emptyMessage}
              </ComboboxPrimitive.Empty>
              <ComboboxPrimitive.List className="flex flex-col gap-0.5 outline-none data-empty:p-0">
                {(item, index) => (
                  <ComboboxOptionItem
                    key={itemKey(item as ComboboxOption<T>, index)}
                    item={item as ComboboxOption<T>}
                    index={index}
                    registerItem={registerItem}
                    activeIndex={activeIndex}
                  ></ComboboxOptionItem>
                )}
              </ComboboxPrimitive.List>
            </ComboboxPrimitive.Popup>
          </motion.div>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </>
  )

  const root = freeform ? (
    <AutocompletePrimitive.Root<ComboboxOption<T>>
      actionsRef={actionsRef}
      autoHighlight
      disabled={resolvedDisabled}
      filter={filterItems}
      itemToStringValue={(item) => String(item.value)}
      items={items}
      modal={false}
      open={open}
      openOnInputClick
      value={inputValue ?? ""}
      onOpenChange={handleOpenChange}
      onValueChange={(next, details) => onInputValueChange?.(next, details)}
    >
      {content}
    </AutocompletePrimitive.Root>
  ) : (
    <ComboboxPrimitive.Root<ComboboxOption<T>>
      actionsRef={actionsRef}
      autoHighlight
      disabled={resolvedDisabled}
      filter={filterItems}
      inputValue={inputValue}
      items={items}
      itemToStringLabel={(item) => item.label}
      modal={false}
      open={open}
      onInputValueChange={(next, details) => onInputValueChange?.(next, details)}
      onOpenChange={handleOpenChange}
      onValueChange={(next) => onValueChange?.(next?.value ?? null)}
      {...selectionProps}
    >
      {content}
    </ComboboxPrimitive.Root>
  )

  return size ? <SizeProvider size={size}>{root}</SizeProvider> : root
}

interface ComboboxComponent {
  <T>(props: ComboboxProps<T> & { ref?: React.Ref<HTMLDivElement> }): React.ReactElement
  displayName?: string
}

const Combobox = forwardRef(ComboboxInner) as ComboboxComponent

Combobox.displayName = "Combobox"

export { Combobox }
export type { ComboboxOption, ComboboxProps }
