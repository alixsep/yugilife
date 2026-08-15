import { memo } from "react"

import { Plus, Trash2 } from "lucide-react"
import { parseRichText, plainTextFromRichText } from "yugilife-core"

import { Button } from "@/components/ui/button"
import { CheckboxGroup, CheckboxItem } from "@/components/ui/checkbox-group"
import { Combobox } from "@/components/ui/combobox"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { ImageDropzone } from "@/components/ui/file-upload"
import { Input, Textarea } from "@/components/ui/input"
import { LinkArrowSelector } from "@/components/ui/link-arrow-selector"
import { NumberInput } from "@/components/ui/number-input"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { Toggle } from "@/components/ui/toggle"

import type { CardFieldDefinition, CardFieldValue } from "yugilife-core"

interface CardFieldInputProps {
  field: CardFieldDefinition
  value: CardFieldValue
  onChange: (name: string, value: CardFieldValue) => void
}

function textValue(value: CardFieldValue) {
  return typeof value === "string" || typeof value === "number" ? String(value) : ""
}

function lineValue(value: CardFieldValue) {
  return Array.isArray(value) ? value.map(String).join("\n") : textValue(value)
}

function numberPair(value: CardFieldValue): [number | undefined, number | undefined] {
  if (Array.isArray(value) && value.length === 2) {
    return [
      typeof value[0] === "number" && Number.isFinite(value[0]) ? value[0] : undefined,
      typeof value[1] === "number" && Number.isFinite(value[1]) ? value[1] : undefined,
    ]
  }
  return [undefined, undefined]
}

function optionLabel(option: string) {
  return option.replaceAll("-", " ").replace(/\b\w/g, (character) => character.toUpperCase())
}

function textListValues(value: CardFieldValue) {
  if (Array.isArray(value)) {
    const entries = value.map(String)
    return entries.length > 0 ? entries : [""]
  }
  return [textValue(value)]
}

function richTextWarning(value: CardFieldValue) {
  const source =
    typeof value === "string"
      ? value
      : Array.isArray(value) && value.every((entry) => typeof entry === "string")
        ? value.join("\n")
        : ""
  return parseRichText(source).warnings
}

function TextWarnings({ value }: { value: CardFieldValue }) {
  const warnings = richTextWarning(value)
  if (warnings.length === 0) return null
  return <FieldError>{warnings[0]?.message}</FieldError>
}

export const CardFieldInput = memo(function CardFieldInput({
  field,
  onChange,
  value,
}: CardFieldInputProps) {
  const label = `${field.label}${field.required ? " *" : ""}`

  if (field.kind === "boolean") {
    return (
      <Field className="w-full min-w-0">
        <FieldLabel htmlFor={`card-field-${field.name}`}>{label}</FieldLabel>
        <Toggle
          aria-label={label}
          className="w-full"
          id={`card-field-${field.name}`}
          pressed={value === true}
          onPressedChange={(pressed) => onChange(field.name, pressed)}
        >
          {value === true ? "On" : "Off"}
        </Toggle>
      </Field>
    )
  }

  if (field.kind === "number") {
    return (
      <Field className="w-full min-w-0">
        <FieldLabel>{label}</FieldLabel>
        <NumberInput
          max={field.max}
          min={field.min}
          required={field.required}
          value={typeof value === "number" ? value : null}
          onValueChange={(next) => onChange(field.name, next ?? undefined)}
        />
      </Field>
    )
  }

  if (field.kind === "number-pair") {
    const pair = numberPair(value)
    return (
      <fieldset className="grid min-w-0 gap-2">
        <legend className="text-body mb-1">{label}</legend>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
          {pair.map((entry, index) => (
            <Field className="min-w-0" key={index}>
              <FieldLabel>{index === 0 ? "Left" : "Right"}</FieldLabel>
              <NumberInput
                max={field.max}
                min={field.min}
                value={entry ?? null}
                onValueChange={(value) => {
                  const next: [number | undefined, number | undefined] = [...pair]
                  next[index] = value ?? undefined
                  onChange(field.name, next.every((entry) => entry === undefined) ? [] : next)
                }}
              />
            </Field>
          ))}
        </div>
      </fieldset>
    )
  }

  if (field.kind === "text-list") {
    if (field.options) {
      const selected = Array.isArray(value) ? value.map(String) : []
      if (field.name === "linkArrows") {
        return (
          <Field className="w-full min-w-0">
            <FieldLabel>{label}</FieldLabel>
            <LinkArrowSelector
              options={field.options}
              selected={selected}
              onToggle={(option) => {
                const next = new Set(selected)
                if (next.has(option)) next.delete(option)
                else next.add(option)
                onChange(
                  field.name,
                  field.options?.filter((entry) => next.has(entry)),
                )
              }}
            />
          </Field>
        )
      }
      return (
        <fieldset className="grid gap-2">
          <legend className="text-body mb-1">{label}</legend>
          <CheckboxGroup
            className="w-full"
            checkedIndices={
              new Set(
                field.options.flatMap((option, index) =>
                  selected.includes(option) ? [index] : [],
                ),
              )
            }
          >
            {field.options.map((option) => (
              <CheckboxItem
                checked={selected.includes(option)}
                index={field.options?.indexOf(option) ?? 0}
                key={option}
                label={optionLabel(option)}
                onToggle={() => {
                  const next = !selected.includes(option)
                    ? [...selected, option]
                    : selected.filter((entry) => entry !== option)
                  onChange(
                    field.name,
                    field.options?.filter((entry) => next.includes(entry)),
                  )
                }}
              />
            ))}
          </CheckboxGroup>
        </fieldset>
      )
    }
    const entries = textListValues(value)
    const canAdd = field.maxItems === undefined || entries.length < field.maxItems
    const canRemove = !field.required || entries.length > 1

    return (
      <fieldset className="grid gap-2">
        <legend className="text-body mb-1">{label}</legend>
        <div className="grid gap-2">
          {entries.map((entry, index) => (
            <div className="flex min-w-0 items-center gap-1" key={index}>
              <Input
                aria-label={`${field.label} ${index + 1}`}
                className="min-w-0 flex-1"
                required={field.required && index === 0}
                value={entry}
                onChange={(event) => {
                  const next = [...entries]
                  next[index] = event.target.value
                  onChange(field.name, next)
                }}
              />
              <Button
                aria-label={`Add ${field.label} field after ${index + 1}`}
                disabled={!canAdd}
                size="icon"
                variant="ghost"
                type="button"
                onClick={() => {
                  const next = [...entries]
                  next.splice(index + 1, 0, "")
                  onChange(field.name, next)
                }}
              >
                <Plus />
              </Button>
              <ConfirmDialog
                confirmLabel="Remove item"
                description={`This removes item ${index + 1} from ${field.label.toLowerCase()}.`}
                disabled={!canRemove}
                title="Remove this item?"
                onConfirm={() => {
                  const next = entries.filter((_entry, entryIndex) => entryIndex !== index)
                  onChange(field.name, next)
                }}
                trigger={
                  <Button
                    aria-label={`Remove ${field.label} ${index + 1}`}
                    size="icon"
                    variant="ghost"
                    type="button"
                  >
                    <Trash2 />
                  </Button>
                }
              />
            </div>
          ))}
        </div>
        <TextWarnings value={value} />
      </fieldset>
    )
  }

  if (field.kind === "multiline") {
    return (
      <Field>
        <FieldLabel>{label}</FieldLabel>
        <Textarea
          className="min-h-32"
          required={field.required}
          value={lineValue(value)}
          onChange={(event) =>
            onChange(field.name, event.target.value === "" ? [] : event.target.value.split("\n"))
          }
        />
        <TextWarnings value={value} />
      </Field>
    )
  }

  if (field.kind === "image") {
    return (
      <Field>
        <FieldLabel>{label}</FieldLabel>
        <ImageDropzone
          accept="image/*"
          removeButtonSize="icon"
          value={value instanceof File ? value : null}
          onValueChange={(file) => onChange(field.name, file ?? undefined)}
        />
      </Field>
    )
  }

  if (field.options) {
    return (
      <Field>
        <FieldLabel>{label}</FieldLabel>
        <Select
          value={textValue(value)}
          onValueChange={(next) => onChange(field.name, next || undefined)}
          {...(field.required === undefined ? {} : { required: field.required })}
        >
          <SelectTrigger className="w-full" placeholder="Choose an option" />
          <SelectContent>
            {!field.required && (
              <SelectItem index={0} value="">
                None
              </SelectItem>
            )}
            {field.options.map((option, index) => (
              <SelectItem index={index + (field.required ? 0 : 1)} key={option} value={option}>
                {optionLabel(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    )
  }

  if (field.suggestions) {
    const items = field.suggestions.map((suggestion) => ({
      label: suggestion.label ?? plainTextFromRichText(parseRichText(suggestion.value).document),
      value: suggestion.value,
    }))
    return (
      <Field>
        <FieldLabel>{label}</FieldLabel>
        <Combobox
          freeform
          inputProps={{ required: field.required }}
          inputValue={textValue(value)}
          items={items}
          placeholder={`Search ${field.label.toLocaleLowerCase()}…`}
          onInputValueChange={(next) => onChange(field.name, next)}
        />
        <TextWarnings value={value} />
      </Field>
    )
  }

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        required={field.required}
        value={textValue(value)}
        onChange={(event) => onChange(field.name, event.target.value)}
      />
      <TextWarnings value={value} />
    </Field>
  )
})
