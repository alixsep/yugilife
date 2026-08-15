import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

import type { ComponentProps, ReactElement } from "react"

interface ConfirmDialogProps {
  cancelLabel?: string
  confirmLabel: string
  description: string
  disabled?: boolean
  onConfirm: () => void
  title: string
  trigger: ReactElement<ComponentProps<typeof Button>>
}

function ConfirmDialog({
  cancelLabel = "Cancel",
  confirmLabel,
  description,
  disabled,
  onConfirm,
  title,
  trigger,
}: ConfirmDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild disabled={disabled}>
        {trigger}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{cancelLabel}</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button onClick={onConfirm}>{confirmLabel}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { ConfirmDialog }
