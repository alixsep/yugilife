"use client"

import { createContext, forwardRef, useContext, useEffect, useMemo, useRef, useState } from "react"

import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { AnimatePresence, motion } from "framer-motion"

import { SelectionBackgrounds, useMergeSplitBlocks } from "@/hooks/use-merge-split"
import { useProximityHover } from "@/hooks/use-proximity-hover"
import { fontWeights } from "@/lib/font-weight"
import { useShape } from "@/lib/shape-context"
import { SizeProvider, useSize } from "@/lib/size-context"
import { spring } from "@/lib/springs"
import { cn } from "@/lib/utils"

import type { SizeVariant } from "@/lib/size-context"
import type { HTMLAttributes, ReactNode } from "react"

interface CheckboxGroupContextValue {
  registerItem: (index: number, element: HTMLElement | null) => void
  activeIndex: number | null
}

const CheckboxGroupContext = createContext<CheckboxGroupContextValue | null>(null)

function useCheckboxGroup() {
  const ctx = useContext(CheckboxGroupContext)
  if (!ctx) throw new Error("useCheckboxGroup must be used within a CheckboxGroup")
  return ctx
}

function mapsEqual(left: Map<number, number>, right: Map<number, number>) {
  if (left.size !== right.size) return false
  for (const [key, value] of right) {
    if (left.get(key) !== value) return false
  }
  return true
}

interface CheckboxGroupProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  checkedIndices: Set<number>
  /** Pins the group's rows to one step of the size ladder (default 36px,
   *  compact 28px — see /docs/sizes). Omitted, it follows the surrounding
   *  SizeProvider. */
  size?: SizeVariant
}

const CheckboxGroup = forwardRef<HTMLDivElement, CheckboxGroupProps>(
  ({ children, checkedIndices, size, className, ...props }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const pointerInteractionRef = useRef(false)
    const [previousGroupMap, setPreviousGroupMap] = useState<Map<number, number>>(() => new Map())
    const [nextGroupId, setNextGroupId] = useState(1)

    const {
      activeIndex,
      setActiveIndex,
      itemRects,
      sessionId,
      handlers,
      registerItem,
      measureItems,
    } = useProximityHover(containerRef)

    useEffect(() => {
      measureItems()
    }, [measureItems, children])

    // Group contiguous checked indices into runs with stable IDs
    const runs = useMemo(() => {
      const result: { start: number; end: number }[] = []
      const sortedChecked = [...checkedIndices].sort((a, b) => a - b)
      for (const idx of sortedChecked) {
        const last = result[result.length - 1]
        if (last && idx === last.end + 1) {
          last.end = idx
        } else {
          result.push({ start: idx, end: idx })
        }
      }
      return result
    }, [checkedIndices])

    // Assign stable IDs: reuse previous ID if any member overlaps
    const { checkedGroups, newGroupMap, nextGroupIdAfterRender } = useMemo(() => {
      const usedIds = new Set<number>()
      const nextMap = new Map<number, number>()
      let nextId = nextGroupId
      const groups = runs.map((run) => {
        let stableId: number | null = null
        for (let i = run.start; i <= run.end; i++) {
          const prevId = previousGroupMap.get(i)
          if (prevId !== undefined && !usedIds.has(prevId)) {
            stableId = prevId
            break
          }
        }
        const id = stableId ?? nextId++
        usedIds.add(id)
        for (let i = run.start; i <= run.end; i++) {
          nextMap.set(i, id)
        }
        return { ...run, id }
      })
      return { checkedGroups: groups, newGroupMap: nextMap, nextGroupIdAfterRender: nextId }
    }, [nextGroupId, previousGroupMap, runs])

    useEffect(() => {
      const frame = requestAnimationFrame(() => {
        setPreviousGroupMap((current) => (mapsEqual(current, newGroupMap) ? current : newGroupMap))
        setNextGroupId((current) =>
          current === nextGroupIdAfterRender ? current : Math.max(current, nextGroupIdAfterRender),
        )
      })
      return () => cancelAnimationFrame(frame)
    }, [newGroupMap, nextGroupIdAfterRender])

    const [focusedIndex, setFocusedIndex] = useState<number | null>(null)

    const activeRect = activeIndex !== null ? itemRects[activeIndex] : null
    const focusRect = focusedIndex !== null ? itemRects[focusedIndex] : null
    const shape = useShape()

    // Selected backgrounds, with the merge/split boundary animation when one
    // unchecked row bridges or splits two checked runs.
    const blocks = useMergeSplitBlocks(checkedGroups, itemRects, shape.mergedRadius)

    const group = (
      <CheckboxGroupContext.Provider value={{ registerItem, activeIndex }}>
        <div
          ref={(node) => {
            containerRef.current = node
            if (typeof ref === "function") ref(node)
            else if (ref) ref.current = node
          }}
          onMouseEnter={handlers.onMouseEnter}
          onMouseMove={handlers.onMouseMove}
          onMouseLeave={handlers.onMouseLeave}
          onPointerDownCapture={() => {
            // The row focuses itself on pointer mousedown so keyboard
            // navigation can continue from the clicked item. Mark that focus
            // as pointer-originated so it does not draw the keyboard ring.
            pointerInteractionRef.current = true
          }}
          onPointerUp={() => {
            pointerInteractionRef.current = false
          }}
          onPointerCancel={() => {
            pointerInteractionRef.current = false
          }}
          onFocus={(e) => {
            const indexAttr = (e.target as HTMLElement)
              .closest("[data-proximity-index]")
              ?.getAttribute("data-proximity-index")
            if (indexAttr != null) {
              const idx = Number(indexAttr)
              const pointerFocus = pointerInteractionRef.current
              pointerInteractionRef.current = false
              setActiveIndex(idx)
              setFocusedIndex(
                !pointerFocus && (e.target as HTMLElement).matches(":focus-visible") ? idx : null,
              )
            }
          }}
          onBlur={(e) => {
            // Don't clear hover when focus moves to another item within the group
            if (containerRef.current?.contains(e.relatedTarget)) return
            setFocusedIndex(null)
            setActiveIndex(null)
          }}
          onKeyDown={(e) => {
            // Scope to row wrappers only. The inner checkbox primitive also
            // carries role="checkbox", so a bare [role="checkbox"] selector
            // matches twice per row and arrows skip onto the hidden control.
            const items = Array.from(
              containerRef.current?.querySelectorAll<HTMLElement>("[data-proximity-index]") ?? [],
            )
            const currentIdx = items.indexOf(e.target as HTMLElement)
            if (currentIdx === -1) return

            if (["ArrowDown", "ArrowUp"].includes(e.key)) {
              e.preventDefault()
              const next =
                e.key === "ArrowDown"
                  ? (currentIdx + 1) % items.length
                  : (currentIdx - 1 + items.length) % items.length
              items[next]?.focus()
            } else if (e.key === "Home") {
              e.preventDefault()
              items[0]?.focus()
            } else if (e.key === "End") {
              e.preventDefault()
              items[items.length - 1]?.focus()
            }
          }}
          role="group"
          className={cn("relative flex w-72 max-w-full flex-col select-none", className)}
          {...props}
        >
          {/* Selected backgrounds (merged for contiguous checked items).
              A run is normally one block; mid merge/split it is drawn as two
              abutting halves — see useMergeSplitBlocks. */}
          <SelectionBackgrounds blocks={blocks} />

          {/* Hover background */}
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

          {/* Focus ring */}
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

          {children}
        </div>
      </CheckboxGroupContext.Provider>
    )

    // A size prop pins every row in the group to one ladder step.
    return size ? <SizeProvider size={size}>{group}</SizeProvider> : group
  },
)

CheckboxGroup.displayName = "CheckboxGroup"

interface CheckboxItemProps extends HTMLAttributes<HTMLDivElement> {
  label: string
  index: number
  checked: boolean
  onToggle: () => void
}

const CheckboxItem = forwardRef<HTMLDivElement, CheckboxItemProps>(
  ({ label, index, checked, onToggle, className, ...props }, ref) => {
    const internalRef = useRef<HTMLDivElement>(null)
    const [skipAnimation, setSkipAnimation] = useState(true)
    const { registerItem, activeIndex } = useCheckboxGroup()

    useEffect(() => {
      registerItem(index, internalRef.current)
      return () => registerItem(index, null)
    }, [index, registerItem])

    useEffect(() => {
      const frame = requestAnimationFrame(() => setSkipAnimation(false))
      return () => cancelAnimationFrame(frame)
    }, [])

    const isActive = activeIndex === index
    const shape = useShape()
    const sizeClasses = useSize()
    const compact = sizeClasses.variant === "compact"

    return (
      <div
        ref={(node) => {
          internalRef.current = node
          if (typeof ref === "function") ref(node)
          else if (ref) ref.current = node
        }}
        data-proximity-index={index}
        tabIndex={0}
        role="checkbox"
        aria-checked={checked}
        aria-label={label}
        onClick={onToggle}
        onMouseDown={(e) => {
          // Clicking the 15px checkbox square would natively focus the hidden
          // primitive (nearest focusable ancestor of the click target), after
          // which arrow-key nav dead-zones: the group keydown handler can't
          // find the target among the row wrappers. Prevent the native focus
          // move (click still fires) and land focus on the row instead. Skip
          // genuinely interactive children so we don't hijack their focus.
          const interactive = (e.target as HTMLElement).closest(
            'button:not([tabindex="-1"]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          )
          if (interactive && interactive !== e.currentTarget) return
          e.preventDefault()
          e.currentTarget.focus()
        }}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault()
            onToggle()
          }
        }}
        className={cn(
          // Fixed height (was py-1.5 around a 19.5px line box ≈ 31.5px) so the
          // text-box trim on the label doesn't shrink the row.
          `relative z-10 flex ${sizeClasses.control} items-center ${sizeClasses.gap} ${shape.item} ${sizeClasses.px} cursor-pointer outline-none`,
          className,
        )}
        data-cursor="button"
        {...props}
      >
        {/* Checkbox — Radix primitive for accessibility */}
        <CheckboxPrimitive.Root
          checked={checked}
          onCheckedChange={() => onToggle()}
          tabIndex={-1}
          aria-hidden
          className={cn(
            "relative shrink-0 cursor-pointer appearance-none border-0 bg-transparent p-0 outline-none",
            compact ? "size-3.5" : "size-4",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Border */}
          <div
            className={cn(
              "absolute inset-0 border-solid transition-all duration-80",
              compact ? "rounded-sm" : "rounded-[5px]",
              checked
                ? "border-[1.5px] border-transparent"
                : isActive
                  ? "border-border-strong border-[1.5px]"
                  : "border-border border-[1.5px]",
            )}
          />
          {/* Check mark */}
          <AnimatePresence>
            {checked && (
              <CheckboxPrimitive.Indicator forceMount asChild>
                <motion.svg
                  width={compact ? 16 : 18}
                  height={compact ? 16 : 18}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-foreground absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                  initial={{ opacity: 1 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 1 }}
                >
                  <motion.path
                    d="M6 12L10 16L18 8"
                    initial={{
                      pathLength: skipAnimation ? 1 : 0,
                    }}
                    animate={{
                      pathLength: 1,
                      transition: {
                        duration: 0.08,
                        ease: "easeOut",
                      },
                    }}
                    exit={{
                      pathLength: 0,
                      transition: {
                        duration: 0.04,
                        ease: "easeIn",
                      },
                    }}
                  />
                </motion.svg>
              </CheckboxPrimitive.Indicator>
            )}
          </AnimatePresence>
        </CheckboxPrimitive.Root>

        {/* Label */}
        {/* Both stacked spans carry the text-box trim so the invisible bold
            sizer and the visible label keep identical boxes. */}
        <span className={cn("inline-grid", sizeClasses.text)}>
          <span
            className="invisible col-start-1 row-start-1 [text-box:trim-both_cap_alphabetic]"
            style={{ fontVariationSettings: fontWeights.semibold }}
            aria-hidden="true"
          >
            {label}
          </span>
          <span
            className={cn(
              "col-start-1 row-start-1 transition-[color,font-variation-settings] duration-80 [text-box:trim-both_cap_alphabetic]",
              checked || isActive ? "text-foreground" : "text-muted-foreground",
            )}
            style={{
              fontVariationSettings: checked ? fontWeights.semibold : fontWeights.normal,
            }}
          >
            {label}
          </span>
        </span>
      </div>
    )
  },
)

CheckboxItem.displayName = "CheckboxItem"

export { CheckboxGroup, CheckboxItem }
export default CheckboxGroup
