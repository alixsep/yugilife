import { forwardRef, useId } from "react"

import { useSize } from "@/lib/size-context"
import { cn } from "@/lib/utils"

import { FieldContext, useFieldContext } from "./field-context"

import type { HTMLAttributes, LabelHTMLAttributes, ReactNode } from "react"

interface FieldProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode
  disabled?: boolean
  id?: string
  invalid?: boolean
}

const Field = forwardRef<HTMLDivElement, FieldProps>(
  ({ children, className, disabled = false, id, invalid = false, ...props }, ref) => {
    const generatedId = useId().replaceAll(":", "")
    const controlId = id ?? `field-${generatedId}`
    const contextValue = {
      controlId,
      descriptionId: `${controlId}-description`,
      errorId: `${controlId}-error`,
      invalid,
      disabled,
    }

    return (
      <FieldContext.Provider value={contextValue}>
        <div
          ref={ref}
          className={cn("grid gap-1.5", className)}
          data-disabled={disabled || undefined}
          data-invalid={invalid || undefined}
          {...props}
        >
          {children}
        </div>
      </FieldContext.Provider>
    )
  },
)

Field.displayName = "Field"

const FieldLabel = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, htmlFor, ...props }, ref) => {
    const field = useFieldContext()
    const sizeClasses = useSize()
    return (
      <label
        ref={ref}
        htmlFor={htmlFor ?? field?.controlId}
        className={cn("text-foreground", sizeClasses.body, className)}
        {...props}
      />
    )
  },
)

FieldLabel.displayName = "FieldLabel"

const FieldDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, id, ...props }, ref) => {
    const field = useFieldContext()
    const sizeClasses = useSize()
    return (
      <p
        ref={ref}
        id={id ?? field?.descriptionId}
        className={cn("text-muted-foreground", sizeClasses.caption, className)}
        {...props}
      />
    )
  },
)

FieldDescription.displayName = "FieldDescription"

const FieldError = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ children, className, id, ...props }, ref) => {
    const field = useFieldContext()
    const sizeClasses = useSize()
    if (!children) return null
    return (
      <p
        ref={ref}
        id={id ?? field?.errorId}
        className={cn("text-destructive", sizeClasses.caption, className)}
        role="alert"
        {...props}
      >
        {children}
      </p>
    )
  },
)

FieldError.displayName = "FieldError"

export { Field, FieldDescription, FieldError, FieldLabel }
export type { FieldProps }
