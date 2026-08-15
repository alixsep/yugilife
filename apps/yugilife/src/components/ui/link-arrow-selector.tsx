import { createElement } from "react"

import { useIcon } from "@/lib/icon-context"

import { Toggle } from "./toggle"

import type { IconName } from "@/lib/icon-context"

const arrowPositions = [
  { value: "top-left", label: "Top left", icon: "arrow-up-left" },
  { value: "top-center", label: "Top center", icon: "arrow-up" },
  { value: "top-right", label: "Top right", icon: "arrow-up-right" },
  { value: "left-center", label: "Left center", icon: "arrow-left" },
  { value: "right-center", label: "Right center", icon: "arrow-right" },
  { value: "bottom-left", label: "Bottom left", icon: "arrow-down-left" },
  { value: "bottom-center", label: "Bottom center", icon: "arrow-down" },
  { value: "bottom-right", label: "Bottom right", icon: "arrow-down-right" },
] as const satisfies readonly { value: string; label: string; icon: IconName }[]

const grid = [
  arrowPositions[0],
  arrowPositions[1],
  arrowPositions[2],
  arrowPositions[3],
  null,
  arrowPositions[4],
  arrowPositions[5],
  arrowPositions[6],
  arrowPositions[7],
] as const

interface LinkArrowSelectorProps {
  options: readonly string[]
  selected: readonly string[]
  onToggle: (value: string) => void
}

function LinkArrowButton({
  checked,
  onToggle,
  position,
}: {
  checked: boolean
  onToggle: (value: string) => void
  position: (typeof arrowPositions)[number]
}) {
  const Icon = useIcon(position.icon)

  return (
    <Toggle
      aria-label={position.label}
      onPressedChange={() => onToggle(position.value)}
      pressed={checked}
      size="icon"
    >
      {createElement(Icon, { size: 18, strokeWidth: 1.75 })}
    </Toggle>
  )
}

function LinkArrowSelector({ onToggle, options, selected }: LinkArrowSelectorProps) {
  const available = new Set(options)
  const selectedSet = new Set(selected)

  return (
    <div aria-label="Link arrow positions" className="grid w-fit grid-cols-3 gap-1" role="group">
      {grid.map((position, index) => {
        if (!position) {
          return <div aria-hidden="true" className="size-9" key={`empty-${index}`} />
        }
        if (!available.has(position.value)) return <div className="size-9" key={position.value} />

        const checked = selectedSet.has(position.value)
        return (
          <LinkArrowButton
            checked={checked}
            key={position.value}
            onToggle={onToggle}
            position={position}
          />
        )
      })}
    </div>
  )
}

export { LinkArrowSelector }
export type { LinkArrowSelectorProps }
