import type { StoredTemplateRecord } from "./template-storage"

export function templateManagerActionLabel({
  hasError,
  loaded,
  loading,
  selectedTemplateVersion,
  storedTemplate,
}: {
  hasError: boolean
  loaded: boolean
  loading: boolean
  selectedTemplateVersion: string | undefined
  storedTemplate: Pick<StoredTemplateRecord, "version"> | undefined
}) {
  if (loading) return "Downloading…"
  if (loaded) return "Loaded"
  if (storedTemplate?.version === selectedTemplateVersion) return "Use cached template"
  if (storedTemplate) return "Update assets"
  if (hasError) return "Retry download"
  return "Download assets"
}
