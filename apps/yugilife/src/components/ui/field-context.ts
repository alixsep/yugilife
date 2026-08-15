import { createContext, useContext } from "react"

interface FieldContextValue {
  controlId: string
  descriptionId: string
  errorId: string
  invalid: boolean
  disabled: boolean
}

const FieldContext = createContext<FieldContextValue | null>(null)

function useFieldContext() {
  return useContext(FieldContext)
}

function mergeIds(...ids: (string | undefined)[]) {
  const unique = [...new Set(ids.flatMap((id) => id?.split(/\s+/) ?? []).filter(Boolean))]
  return unique.length > 0 ? unique.join(" ") : undefined
}

export { FieldContext, mergeIds, useFieldContext }
export type { FieldContextValue }
