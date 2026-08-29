import { createElement, forwardRef, useEffect, useId, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DashedBorder } from "@/components/ui/dashed-border"
import { useIcon } from "@/lib/icon-context"
import { useShape } from "@/lib/shape-context"
import { cn } from "@/lib/utils"

import { mergeIds, useFieldContext } from "./field-context"

import type { DragEvent, HTMLAttributes, KeyboardEvent, ReactNode } from "react"

interface ImageDropzoneProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "defaultValue" | "onChange" | "onError"
> {
  accept?: string
  alt?: string
  defaultValue?: Blob | null
  disabled?: boolean
  error?: ReactNode
  maxSize?: number
  multiple?: boolean
  onError?: (message: string) => void
  onFilesSelected?: (files: File[]) => void
  onValueChange?: (file: File | null) => void
  previewUrl?: string
  removeButtonSize?: "icon" | "icon-compact"
  removeLabel?: string
  showAcceptHint?: boolean
  value?: Blob | null
}

function blobName(blob: Blob) {
  return blob instanceof File && blob.name ? blob.name : "Stored image"
}

function matchesAccept(file: File, accept: string) {
  const rules = accept
    .split(",")
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean)
  if (rules.length === 0) return true
  const fileName = file.name.toLowerCase()
  return rules.some((rule) => {
    if (rule.startsWith(".")) return fileName.endsWith(rule)
    if (rule.endsWith("/*")) return file.type.startsWith(`${rule.slice(0, -1)}`)
    return file.type.toLowerCase() === rule
  })
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const ImageDropzone = forwardRef<HTMLDivElement, ImageDropzoneProps>(
  (
    {
      accept = "image/*",
      alt = "Uploaded image preview",
      children,
      className,
      defaultValue = null,
      disabled = false,
      error,
      maxSize,
      multiple = false,
      onError,
      onFilesSelected,
      onValueChange,
      previewUrl,
      removeButtonSize = "icon-compact",
      removeLabel = "Remove image",
      showAcceptHint = true,
      value,
      ...props
    },
    ref,
  ) => {
    const inputId = useId()
    const inputRef = useRef<HTMLInputElement>(null)
    const [internalValue, setInternalValue] = useState<Blob | null>(defaultValue)
    const [objectUrl, setObjectUrl] = useState<string | null>(null)
    const [dragging, setDragging] = useState(false)
    const [localError, setLocalError] = useState<string | null>(null)
    const isControlled = value !== undefined
    const currentValue = isControlled ? value : internalValue
    const field = useFieldContext()
    const controlId = field?.controlId ?? inputId
    const ImageIcon = useIcon("image")
    const XIcon = useIcon("x")
    const shape = useShape()

    useEffect(() => {
      if (!currentValue) {
        setObjectUrl(null)
        return
      }
      const nextUrl = URL.createObjectURL(currentValue)
      const frame = requestAnimationFrame(() => setObjectUrl(nextUrl))
      return () => {
        cancelAnimationFrame(frame)
        URL.revokeObjectURL(nextUrl)
      }
    }, [currentValue])

    const reportError = (message: string) => {
      setLocalError(message)
      onError?.(message)
    }

    const acceptFiles = (files: File[]) => {
      if (files.length === 0) return
      setLocalError(null)
      const accepted = files.filter((file) => matchesAccept(file, accept))
      if (accepted.length !== files.length) {
        reportError(`Choose a file matching ${accept}.`)
      }
      const withinLimit = accepted.filter((file) => maxSize === undefined || file.size <= maxSize)
      if (withinLimit.length !== accepted.length && maxSize !== undefined) {
        reportError(`This file is too large. Maximum size is ${formatBytes(maxSize)}.`)
      }
      if (withinLimit.length === 0) return
      onFilesSelected?.(withinLimit)
      if (multiple) return
      const file = withinLimit[0]
      if (!file) return
      if (!isControlled) setInternalValue(file)
      onValueChange?.(file)
    }

    const handleDrop = (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setDragging(false)
      if (!disabled) acceptFiles([...event.dataTransfer.files])
    }

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (disabled || (event.key !== "Enter" && event.key !== " ")) return
      event.preventDefault()
      inputRef.current?.click()
    }

    const handleRemove = () => {
      if (!isControlled) setInternalValue(null)
      setLocalError(null)
      if (inputRef.current) inputRef.current.value = ""
      onValueChange?.(null)
    }

    const displayedError = error ?? localError
    const displayedPreview = previewUrl ?? objectUrl
    const errorId = field?.errorId ?? `${inputId}-error`
    const describedBy = mergeIds(field?.descriptionId, displayedError ? errorId : undefined)

    return (
      <div ref={ref} className={cn("grid gap-2", className)} {...props}>
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled || undefined}
          aria-describedby={describedBy}
          aria-invalid={field?.invalid || undefined}
          data-cursor="drag"
          className={cn(
            "bg-muted/30 text-muted-foreground hover:bg-hover relative grid min-h-36 cursor-pointer place-items-center overflow-hidden p-3 text-center ring-1 ring-transparent transition-[background-color,color,box-shadow] duration-80 outline-none focus-visible:ring-(--focus-ring)",
            shape.container,
            dragging && "bg-hover",
            disabled && "pointer-events-none opacity-50",
            displayedPreview && "min-h-48",
          )}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault()
            if (!disabled) setDragging(true)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onKeyDown={handleKeyDown}
        >
          <DashedBorder className={dragging ? "text-foreground" : "text-border"} />
          {displayedPreview ? (
            <img
              className="absolute inset-0 size-full object-contain"
              src={displayedPreview}
              alt={alt}
            />
          ) : (
            <div className="grid justify-items-center gap-2">
              {createElement(ImageIcon, { size: 24, strokeWidth: 1.5 })}
              <span>{children ?? "Drop an image here or click to browse"}</span>
              {showAcceptHint && <span className="text-xs">{accept}</span>}
            </div>
          )}
          <input
            ref={inputRef}
            id={controlId}
            className="sr-only"
            accept={accept}
            multiple={multiple}
            disabled={disabled}
            aria-describedby={describedBy}
            aria-invalid={field?.invalid || undefined}
            type="file"
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              acceptFiles([...(event.target.files ?? [])])
              event.target.value = ""
            }}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          {currentValue && (
            <span className="text-muted-foreground min-w-0 truncate text-xs">
              {blobName(currentValue)} · {formatBytes(currentValue.size)}
            </span>
          )}
          {currentValue && (
            <ConfirmDialog
              confirmLabel={removeLabel}
              description={`“${blobName(currentValue)}” will be removed from this field.`}
              title={`${removeLabel}?`}
              onConfirm={handleRemove}
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  size={removeButtonSize}
                  aria-label={removeLabel}
                >
                  {createElement(XIcon, { size: 14, strokeWidth: 1.5 })}
                </Button>
              }
            />
          )}
        </div>
        {displayedError && (
          <p id={errorId} className="text-destructive text-xs" role="alert">
            {displayedError}
          </p>
        )}
      </div>
    )
  },
)

ImageDropzone.displayName = "ImageDropzone"

const FileUpload = ImageDropzone

export { FileUpload, ImageDropzone }
export type { ImageDropzoneProps }
