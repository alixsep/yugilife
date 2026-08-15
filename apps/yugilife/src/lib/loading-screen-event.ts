export const LOADING_COMPLETE_EVENT = "yugilife:loading-complete"

export function announceLoadingComplete() {
  if (typeof document === "undefined") return

  document.documentElement.dataset.loadingComplete = "true"
  window.dispatchEvent(new Event(LOADING_COMPLETE_EVENT))
}
