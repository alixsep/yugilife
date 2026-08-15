import { useEffect, useRef, useState } from "react"

import {
  defaultReferenceTransform,
  readReferenceTransforms,
  writeReferenceTransform,
} from "./reference-settings"
import {
  deleteStoredReference,
  getReferenceStorageMode,
  loadStoredReferences,
  storeReference,
} from "./reference-storage"

import type { ReferenceTransform } from "./reference-settings"

export interface ReferenceImage {
  id: string
  name: string
  src: string
  transform: ReferenceTransform
}

export function useReferenceImages() {
  const [references, setReferences] = useState<readonly ReferenceImage[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [storageError, setStorageError] = useState<string>()
  const [settingsError, setSettingsError] = useState<string>()
  const [storageMode, setStorageMode] = useState<"indexeddb" | "memory">(getReferenceStorageMode())
  const objectUrls = useRef(new Set<string>())

  useEffect(() => {
    let cancelled = false
    const urls = objectUrls.current
    void loadStoredReferences()
      .then((stored) => {
        if (cancelled) return
        setStorageMode(getReferenceStorageMode())
        const transforms = readReferenceTransforms()
        const restored = stored.map((reference) => {
          const src = URL.createObjectURL(reference.blob)
          urls.add(src)
          return {
            id: reference.id,
            name: reference.name,
            src,
            transform: transforms[reference.id] ?? { ...defaultReferenceTransform },
          }
        })
        setReferences((current) => {
          const restoredIds = new Set(restored.map((reference) => reference.id))
          return [...restored, ...current.filter((reference) => !restoredIds.has(reference.id))]
        })
      })
      .catch((error: unknown) => {
        setStorageMode(getReferenceStorageMode())
        setStorageError(error instanceof Error ? error.message : String(error))
      })

    return () => {
      cancelled = true
      urls.forEach((url) => URL.revokeObjectURL(url))
      urls.clear()
    }
  }, [])

  function addFiles(files: readonly File[]) {
    const added = files
      .filter((file) => file.type.startsWith("image/"))
      .map((file, index) => {
        const id = crypto.randomUUID()
        const src = URL.createObjectURL(file)
        objectUrls.current.add(src)
        void storeReference({
          blob: file,
          createdAt: Date.now() + index,
          id,
          name: file.name,
        })
          .then(() => setStorageMode(getReferenceStorageMode()))
          .catch((error: unknown) => {
            setStorageMode(getReferenceStorageMode())
            setStorageError(error instanceof Error ? error.message : String(error))
          })
        return { id, name: file.name, src, transform: { ...defaultReferenceTransform } }
      })
    if (added.length > 0) {
      setReferences((current) => [...current, ...added])
      setSelectedIndex(references.length)
    }
  }

  function setTransform(property: keyof ReferenceTransform, value: number) {
    const selected = references[selectedIndex]
    if (!selected) return
    const transform = { ...selected.transform, [property]: value }
    setReferences((current) =>
      current.map((reference, index) =>
        index === selectedIndex ? { ...reference, transform } : reference,
      ),
    )
    const error = writeReferenceTransform(selected.id, transform)
    if (error) setSettingsError(error)
    else setSettingsError(undefined)
  }

  function resetTransform() {
    const selected = references[selectedIndex]
    if (!selected) return
    const transform = { ...defaultReferenceTransform }
    setReferences((current) =>
      current.map((reference, index) =>
        index === selectedIndex ? { ...reference, transform } : reference,
      ),
    )
    const error = writeReferenceTransform(selected.id, transform)
    if (error) setSettingsError(error)
    else setSettingsError(undefined)
  }

  function deleteSelected() {
    const selected = references[selectedIndex]
    if (!selected) return
    const remaining = references.filter((reference) => reference.id !== selected.id)
    setReferences(remaining)
    setSelectedIndex(Math.min(selectedIndex, Math.max(0, remaining.length - 1)))
    objectUrls.current.delete(selected.src)
    URL.revokeObjectURL(selected.src)
    const settingsError = writeReferenceTransform(selected.id)
    if (settingsError) setSettingsError(settingsError)
    else setSettingsError(undefined)
    void deleteStoredReference(selected.id)
      .then(() => setStorageMode(getReferenceStorageMode()))
      .catch((error: unknown) => {
        setStorageMode(getReferenceStorageMode())
        setStorageError(error instanceof Error ? error.message : String(error))
      })
  }

  return {
    addFiles,
    deleteSelected,
    references,
    resetTransform,
    selectedIndex,
    selectedReference: references[selectedIndex],
    setSelectedIndex,
    setTransform,
    storageMode,
    storageError,
    settingsError,
  }
}
