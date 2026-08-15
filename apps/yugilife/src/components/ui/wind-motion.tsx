import { forwardRef, useRef } from "react"

import { useWindMotion } from "@/hooks/use-wind-motion"

import type { ForwardedRef, HTMLAttributes } from "react"

type WindMotionProps = HTMLAttributes<HTMLElement> & {
  as?: "div" | "span"
}

function assignRef(ref: ForwardedRef<HTMLElement>, value: HTMLElement | null) {
  if (typeof ref === "function") ref(value)
  else if (ref) ref.current = value
}

/**
 * Wraps any content in a small wind-like motion field. Pointer movement is
 * treated as an impulse and supported device orientation becomes a gentle
 * sustained input on coarse-pointer devices.
 */
const WindMotion = forwardRef<HTMLElement, WindMotionProps>(
  ({ as: Component = "div", children, style, ...props }, forwardedRef) => {
    const motionRef = useRef<HTMLElement>(null)
    useWindMotion(motionRef)

    return (
      <Component
        {...props}
        ref={(element) => {
          motionRef.current = element
          assignRef(forwardedRef, element)
        }}
        style={{
          ...style,
          transform:
            "perspective(900px) translate3d(var(--wind-motion-x, 0px), var(--wind-motion-y, 0px), 0) rotateX(var(--wind-motion-tilt-y, 0deg)) rotateY(var(--wind-motion-tilt-x, 0deg)) rotateZ(var(--wind-motion-roll, 0deg))",
          transformStyle: "preserve-3d",
          willChange: "transform",
        }}
      >
        {children}
      </Component>
    )
  },
)

WindMotion.displayName = "WindMotion"

export { WindMotion }
export type { WindMotionProps }
