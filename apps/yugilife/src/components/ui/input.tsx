import { forwardRef } from "react"

import { useShape } from "@/lib/shape-context"
import { useSize } from "@/lib/size-context"
import { cn } from "@/lib/utils"

import { mergeIds, useFieldContext } from "./field-context"

import type { SizeVariant } from "@/lib/size-context"
import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react"

interface SharedInputProps {
  size?: SizeVariant
  "data-cursor"?: "button" | "text" | "drag" | "default"
}

function useFieldControlProps(
  describedBy: string | undefined,
  invalid: InputHTMLAttributes<HTMLInputElement>["aria-invalid"],
  disabled: boolean | undefined,
  id: string | undefined,
) {
  const field = useFieldContext()
  return {
    "aria-describedby": mergeIds(
      describedBy,
      field?.descriptionId,
      field?.invalid ? field.errorId : undefined,
    ),
    "aria-invalid": invalid ?? field?.invalid ?? undefined,
    disabled: disabled ?? field?.disabled ?? undefined,
    id: id ?? field?.controlId,
  }
}

const inputClasses =
  "border-border text-foreground placeholder:text-muted-foreground w-full border bg-transparent outline-none ring-1 ring-transparent transition-[border-color,box-shadow] duration-80 hover:border-border focus:outline-none focus-visible:outline-none focus-visible:ring-(--focus-ring) disabled:pointer-events-none disabled:opacity-50"

interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size">, SharedInputProps {}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      disabled,
      id,
      size,
      type,
      "aria-describedby": describedBy,
      "aria-invalid": invalid,
      "data-cursor": cursorMode,
      ...props
    },
    ref,
  ) => {
    const shape = useShape()
    const sizeClasses = useSize(size)
    const fieldProps = useFieldControlProps(describedBy, invalid, disabled, id)
    return (
      <input
        ref={ref}
        className={cn(
          inputClasses,
          sizeClasses.control,
          sizeClasses.px,
          sizeClasses.text,
          shape.input,
          className,
        )}
        {...fieldProps}
        {...props}
        type={type}
        data-cursor={
          cursorMode ??
          (type === "button" ||
          type === "submit" ||
          type === "reset" ||
          type === "checkbox" ||
          type === "radio" ||
          type === "range"
            ? "button"
            : "text")
        }
      />
    )
  },
)

Input.displayName = "Input"

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, SharedInputProps {}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      disabled,
      id,
      size,
      "aria-describedby": describedBy,
      "aria-invalid": invalid,
      "data-cursor": cursorMode,
      ...props
    },
    ref,
  ) => {
    const shape = useShape()
    const sizeClasses = useSize(size)
    const fieldProps = useFieldControlProps(describedBy, invalid, disabled, id)
    return (
      <textarea
        ref={ref}
        className={cn(
          inputClasses,
          "min-h-24 resize-y py-2",
          sizeClasses.px,
          sizeClasses.text,
          shape.input,
          className,
        )}
        {...fieldProps}
        {...props}
        data-cursor={cursorMode ?? "text"}
      />
    )
  },
)

Textarea.displayName = "Textarea"

export { Input, Textarea }
export type { InputProps, TextareaProps }
