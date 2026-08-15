/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

import { runAppearanceTransition } from "./appearance-transition"

import type { ReactNode } from "react"

type ShapeVariant = "pill" | "rounded"

interface ShapeClasses {
  item: string
  bg: string
  focusRing: string
  container: string
  button: string
  input: string
  // Numeric counterpart of `bg`, in px. Needed where individual corners are
  // animated (e.g. the selected-background merge/split animation), which
  // requires per-corner numeric border-radii rather than a class.
  bgRadius: number
  mergedRadius: number
}

const shapeMap: Record<ShapeVariant, ShapeClasses> = {
  pill: {
    item: "rounded-[20px]",
    bg: "rounded-[20px]",
    // +2px over `item` because the focus ring sits 2px outside the element
    // (top/left -2, width/height +4); this keeps the corners concentric so a
    // pill element gets a pill ring (matches the rounded-mode 8px→10px bump).
    focusRing: "rounded-[22px]",
    container: "rounded-3xl",
    button: "rounded-[20px]",
    input: "rounded-[20px]",
    bgRadius: 20,
    mergedRadius: 16,
  },
  rounded: {
    item: "rounded-lg",
    bg: "rounded-lg",
    focusRing: "rounded-[10px]",
    container: "rounded-xl",
    button: "rounded-lg",
    input: "rounded-lg",
    bgRadius: 8,
    mergedRadius: 8,
  },
}

/** Popover/menu surfaces intentionally stay on the tighter radius. */
const popupShape = shapeMap.rounded

interface ShapeContextValue {
  shape: ShapeVariant
  setShape: (shape: ShapeVariant) => void
  classes: ShapeClasses
}

const ShapeContext = createContext<ShapeContextValue | null>(null)

function useShape(): ShapeClasses {
  const ctx = useContext(ShapeContext)
  if (!ctx) return shapeMap.rounded
  return ctx.classes
}

function useShapeContext() {
  const ctx = useContext(ShapeContext)
  if (!ctx) throw new Error("useShapeContext must be used within a ShapeProvider")
  return ctx
}

function ShapeProvider({
  children,
  defaultShape = "rounded",
}: {
  children: ReactNode
  defaultShape?: ShapeVariant
}) {
  const [shape, setShapeState] = useState<ShapeVariant>(defaultShape)

  const setShape = useCallback(
    (next: ShapeVariant) => {
      if (shape === next) return
      runAppearanceTransition(() => setShapeState(next))
    },
    [shape],
  )

  // Publish the current element radius as a CSS custom property so plain-CSS
  // consumers that can't read React context stay in sync with the shape
  // system — e.g. the @layer base :focus-visible fallback ring in
  // index.css. Set on <html> so portalled content sees it too.
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--shape-input-radius",
      `${shapeMap[shape].bgRadius}px`,
    )
  }, [shape])

  const value = useMemo(() => ({ shape, setShape, classes: shapeMap[shape] }), [shape, setShape])

  return <ShapeContext.Provider value={value}>{children}</ShapeContext.Provider>
}

export { popupShape, shapeMap, ShapeProvider, useShape, useShapeContext }
export type { ShapeClasses, ShapeVariant }
