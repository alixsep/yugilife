import { createElement, forwardRef, useEffect, useId, useRef, useState } from "react"

import { Download } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DashedBorder } from "@/components/ui/dashed-border"
import { Tooltip } from "@/components/ui/tooltip"
import { useIcon } from "@/lib/icon-context"
import { useShape } from "@/lib/shape-context"
import { useSize } from "@/lib/size-context"
import { cn } from "@/lib/utils"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog"
import { mergeIds, useFieldContext } from "./field-context"

import type { DragEvent, HTMLAttributes, KeyboardEvent, ReactNode } from "react"

interface ImageDropzoneProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "defaultValue" | "onChange" | "onError"
> {
  accept?: string
  alt?: string
  actionsOverlay?: boolean
  /** Optional control surface joined directly to the bottom of the image input. */
  attachedFooter?: ReactNode
  defaultValue?: Blob | null
  disabled?: boolean
  downloadLabel?: string
  error?: ReactNode
  maxSize?: number
  multiple?: boolean
  onError?: (message: string) => void
  onFilesSelected?: (files: File[]) => void
  onValueChange?: (file: Blob | null) => void
  validateFile?: (file: File) => Promise<void>
  undoRemoval?: boolean
  confirmReplacement?: string | undefined
  previewUrl?: string
  removeLabel?: string
  showAcceptHint?: boolean
  footerActions?: ReactNode
  value?: Blob | null
}

function blobName(blob: Blob) {
  return blob instanceof File && blob.name ? blob.name : "Stored image"
}

function downloadName(blob: Blob) {
  if (blob instanceof File && blob.name) return blob.name
  const extension = blob.type.split("/")[1]?.replace(/[^a-z0-9]+/gi, "") || "bin"
  return `image.${extension}`
}

function downloadBlob(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = downloadName(blob)
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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

const ImageDropzone = forwardRef<HTMLDivElement, ImageDropzoneProps>(
  (
    {
      accept = "image/*",
      actionsOverlay = false,
      attachedFooter,
      alt = "Uploaded image preview",
      children,
      className,
      defaultValue = null,
      disabled = false,
      downloadLabel = "Download",
      error,
      maxSize,
      multiple = false,
      onError,
      onFilesSelected,
      onValueChange,
      validateFile,
      undoRemoval = false,
      confirmReplacement,
      previewUrl,
      removeLabel = "Remove",
      showAcceptHint = true,
      footerActions,
      value,
      ...props
    },
    ref,
  ) => {
    const inputId = useId()
    const inputRef = useRef<HTMLInputElement>(null)
    const validationRequest = useRef(0)
    const [validating, setValidating] = useState(false)
    const [removedValue, setRemovedValue] = useState<Blob>()
    const [pendingFile, setPendingFile] = useState<File>()
    useEffect(
      () => () => {
        validationRequest.current += 1
      },
      [],
    )
    const [internalValue, setInternalValue] = useState<Blob | null>(defaultValue)
    const [objectUrl, setObjectUrl] = useState<string | null>(null)
    const [dragging, setDragging] = useState(false)
    const [localError, setLocalError] = useState<string | null>(null)
    const isControlled = value !== undefined
    const currentValue = isControlled ? value : internalValue
    useEffect(() => {
      validationRequest.current += 1
      setValidating(false)
      setPendingFile(undefined)
    }, [currentValue])
    const field = useFieldContext()
    const controlId = field?.controlId ?? inputId
    const ImageIcon = useIcon("image")
    const XIcon = useIcon("x")
    const shape = useShape()
    const sizeClasses = useSize()

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

    const acceptFiles = async (files: File[]) => {
      const request = ++validationRequest.current
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
      if (validateFile) {
        setValidating(true)
        try {
          await Promise.all(withinLimit.map(validateFile))
        } catch (reason) {
          if (validationRequest.current === request)
            reportError(reason instanceof Error ? reason.message : "Unable to open the image.")
          return
        } finally {
          if (validationRequest.current === request) setValidating(false)
        }
      }
      if (validationRequest.current !== request) return
      setRemovedValue(undefined)
      if (multiple) {
        onFilesSelected?.(withinLimit)
        return
      }
      const file = withinLimit[0]
      if (!file) return
      if (confirmReplacement && currentValue) {
        setPendingFile(file)
        return
      }
      onFilesSelected?.([file])
      if (!isControlled) setInternalValue(file)
      onValueChange?.(file)
    }

    const handleDrop = (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setDragging(false)
      if (!disabled) void acceptFiles([...event.dataTransfer.files])
    }

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (
        event.target !== event.currentTarget ||
        disabled ||
        (event.key !== "Enter" && event.key !== " ")
      )
        return
      event.preventDefault()
      inputRef.current?.click()
    }

    const handleRemove = () => {
      validationRequest.current += 1
      setValidating(false)
      if (undoRemoval && currentValue) setRemovedValue(currentValue)
      if (!isControlled) setInternalValue(null)
      setLocalError(null)
      if (inputRef.current) inputRef.current.value = ""
      onValueChange?.(null)
    }

    const displayedError = error ?? localError
    const displayedPreview = previewUrl ?? objectUrl
    const errorId = field?.errorId ?? `${inputId}-error`
    const describedBy = mergeIds(field?.descriptionId, displayedError ? errorId : undefined)
    const downloadButton = currentValue ? (
      <Tooltip content={downloadLabel} side="bottom">
        <Button
          aria-label={downloadLabel}
          size="icon"
          type="button"
          variant="ghost"
          onClick={() => downloadBlob(currentValue)}
        >
          <Download />
        </Button>
      </Tooltip>
    ) : null
    const removeButton = currentValue ? (
      <ConfirmDialog
        confirmLabel={removeLabel}
        description={`“${blobName(currentValue)}” will be removed from this field.`}
        title={`${removeLabel}?`}
        onConfirm={handleRemove}
        trigger={
          <Button type="button" variant="ghost" size="icon" aria-label={removeLabel}>
            {createElement(XIcon)}
          </Button>
        }
      />
    ) : null
    const actionButtons = currentValue ? (
      <div
        className={cn(
          "flex min-w-0 items-center gap-0",
          actionsOverlay ? "flex-col items-end" : "flex-row flex-wrap justify-end",
        )}
      >
        {actionsOverlay ? (
          <>
            {removeButton}
            {footerActions}
            {downloadButton}
          </>
        ) : (
          <>
            {downloadButton}
            {footerActions}
            {removeButton}
          </>
        )}
      </div>
    ) : null

    return (
      <div
        ref={ref}
        className={cn("grid", attachedFooter ? "gap-0" : "gap-2", className)}
        {...props}
      >
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
            attachedFooter && "z-40",
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
              {showAcceptHint && <span className={sizeClasses.caption}>{accept}</span>}
            </div>
          )}
          {actionsOverlay && actionButtons && (
            <div
              className={cn(
                "absolute top-2 right-2 z-10 flex max-w-[calc(100%-1rem)] flex-col items-end",
              )}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {actionButtons}
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
              void acceptFiles([...(event.target.files ?? [])])
              event.target.value = ""
            }}
          />
        </div>
        {validating && (
          <p role="status" className="text-caption">
            Checking image…
          </p>
        )}
        {undoRemoval && !currentValue && removedValue && (
          <Button
            variant="ghost"
            onClick={() => {
              if (!isControlled) setInternalValue(removedValue)
              onValueChange?.(removedValue)
              setRemovedValue(undefined)
            }}
          >
            Undo removal
          </Button>
        )}
        <Dialog
          open={pendingFile !== undefined}
          onOpenChange={(open) => {
            if (!open) setPendingFile(undefined)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Replace this image?</DialogTitle>
              <DialogDescription>{confirmReplacement}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPendingFile(undefined)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (!pendingFile) return
                  onFilesSelected?.([pendingFile])
                  if (!isControlled) setInternalValue(pendingFile)
                  onValueChange?.(pendingFile)
                  setPendingFile(undefined)
                }}
              >
                Replace image
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {attachedFooter}
        {!actionsOverlay && (
          <div className="flex flex-wrap items-center justify-between gap-2">{actionButtons}</div>
        )}
        {displayedError && (
          <p id={errorId} className={`text-destructive ${sizeClasses.caption}`} role="alert">
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
