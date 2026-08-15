import { forwardRef } from "react"

import { useShape } from "@/lib/shape-context"
import { useSize } from "@/lib/size-context"
import { cn } from "@/lib/utils"

import type { ComponentPropsWithoutRef } from "react"

interface CodeBlockProps extends Omit<ComponentPropsWithoutRef<"pre">, "children"> {
  code: string
}

const CodeBlock = forwardRef<HTMLPreElement, CodeBlockProps>(
  ({ className, code, ...props }, ref) => {
    const shape = useShape()
    const sizeClasses = useSize()

    return (
      <pre
        ref={ref}
        className={cn(
          "border-border bg-muted/60 overflow-x-auto border p-3 leading-5",
          sizeClasses.caption,
          shape.container,
          className,
        )}
        {...props}
      >
        <code>{code}</code>
      </pre>
    )
  },
)

CodeBlock.displayName = "CodeBlock"

export { CodeBlock }
export type { CodeBlockProps }
