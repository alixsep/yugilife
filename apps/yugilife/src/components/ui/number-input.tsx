import { forwardRef, useMemo } from "react"

import { NumberField } from "@base-ui/react/number-field"

import { useIcon } from "@/lib/icon-context"
import { useShape } from "@/lib/shape-context"
import { SizeProvider, useSize } from "@/lib/size-context"
import { cn } from "@/lib/utils"

import { mergeIds, useFieldContext } from "./field-context"

import type { SizeVariant } from "@/lib/size-context"
import type { ComponentPropsWithoutRef } from "react"

type CursorMode = "button" | "text" | "drag" | "default"

type NumberInputProps = Omit<
  ComponentPropsWithoutRef<typeof NumberField.Root>,
  "children" | "className"
> & {
  className?: string
  inputClassName?: string
  inputProps?: Omit<ComponentPropsWithoutRef<typeof NumberField.Input>, "className">
  showStepper?: boolean
  size?: SizeVariant
  "data-cursor"?: CursorMode
}

const NumberInput = forwardRef<HTMLDivElement, NumberInputProps>(
  (
    {
      "aria-describedby": describedBy,
      "aria-invalid": invalid,
      className,
      disabled,
      id,
      inputClassName,
      inputProps,
      showStepper = true,
      size,
      "data-cursor": cursorMode,
      ...props
    },
    ref,
  ) => {
    const field = useFieldContext()
    const shape = useShape()
    const sizeClasses = useSize(size)
    const MinusIcon = useIcon("minus")
    const PlusIcon = useIcon("plus")
    const controlId = id ?? field?.controlId
    const ariaDescribedBy = mergeIds(
      describedBy,
      field?.descriptionId,
      field?.invalid ? field.errorId : undefined,
    )
    const resolvedDisabled = disabled ?? field?.disabled
    const resolvedInvalid = invalid ?? field?.invalid
    const resolvedInputProps = useMemo(
      () => ({
        ...inputProps,
        "aria-describedby": mergeIds(inputProps?.["aria-describedby"], ariaDescribedBy),
        "aria-invalid": inputProps?.["aria-invalid"] ?? resolvedInvalid ?? undefined,
        "data-cursor": "text",
      }),
      [ariaDescribedBy, inputProps, resolvedInvalid],
    )

    const root = (
      <NumberField.Root
        ref={ref}
        id={controlId}
        disabled={resolvedDisabled}
        aria-describedby={ariaDescribedBy}
        aria-invalid={resolvedInvalid || undefined}
        className={cn(
          "border-border text-foreground flex w-full max-w-full min-w-0 items-center overflow-hidden border bg-transparent ring-1 ring-transparent transition-[border-color,box-shadow] duration-80 outline-none focus-within:ring-(--focus-ring) disabled:pointer-events-none disabled:opacity-50",
          sizeClasses.control,
          shape.input,
          className,
        )}
        {...props}
        data-cursor={cursorMode ?? "text"}
      >
        {showStepper && (
          <NumberField.Decrement
            aria-label="Decrease value"
            tabIndex={0}
            className={cn(
              "group text-muted-foreground flex h-full w-8 shrink-0 cursor-pointer items-center justify-center bg-transparent ring-1 ring-transparent transition-[color,background-color,box-shadow] duration-80 outline-none focus-visible:ring-(--focus-ring) disabled:pointer-events-none",
            )}
            data-cursor="button"
          >
            <span
              className={cn(
                "group-hover:bg-hover group-hover:text-foreground flex items-center justify-center transition-colors duration-80",
                "size-full",
                shape.item,
                "rounded-r-none",
              )}
            >
              <MinusIcon size={sizeClasses.icon} strokeWidth={1.75} />
            </span>
          </NumberField.Decrement>
        )}
        <NumberField.Input
          {...resolvedInputProps}
          className={cn(
            "w-0 min-w-0 flex-1 bg-transparent text-center outline-none",
            sizeClasses.px,
            sizeClasses.text,
            inputClassName,
          )}
          data-cursor="text"
        />
        {showStepper && (
          <NumberField.Increment
            aria-label="Increase value"
            tabIndex={0}
            className={cn(
              "group text-muted-foreground flex h-full w-8 shrink-0 cursor-pointer items-center justify-center bg-transparent ring-1 ring-transparent transition-[color,background-color,box-shadow] duration-80 outline-none focus-visible:ring-(--focus-ring) disabled:pointer-events-none",
            )}
            data-cursor="button"
          >
            <span
              className={cn(
                "group-hover:bg-hover group-hover:text-foreground flex items-center justify-center transition-colors duration-80",
                "size-full",
                shape.item,
                "rounded-l-none",
              )}
            >
              <PlusIcon size={sizeClasses.icon} strokeWidth={1.75} />
            </span>
          </NumberField.Increment>
        )}
      </NumberField.Root>
    )

    return size ? <SizeProvider size={size}>{root}</SizeProvider> : root
  },
)

NumberInput.displayName = "NumberInput"

export { NumberInput }
export type { NumberInputProps }
