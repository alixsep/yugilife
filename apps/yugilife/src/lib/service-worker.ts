/** How often an open page asks whether a newer version has been deployed. */
const updateCheckMs = 30 * 60 * 1000
/** A failed chunk load reloads the page at most once in this window, so offline cannot loop. */
const reloadGuardMs = 10_000
const reloadKey = "yugilife-chunk-reload"

/**
 * Makes the production app installable and keeps it on the latest deploy.
 *
 * The worker itself (scripts/service-worker.js) always fetches pages from the network, so every
 * load runs the newest version. What is left is a tab that stays open across a deploy: it checks
 * for a new worker whenever it comes back into view and every half hour, and if it then asks for a
 * code chunk that the new deploy no longer has, it reloads onto the new version instead of failing.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD) return

  window.addEventListener("vite:preloadError", (event) => {
    if (!navigator.onLine) return
    try {
      const last = Number(sessionStorage.getItem(reloadKey) ?? 0)
      if (Date.now() - last < reloadGuardMs) return
      sessionStorage.setItem(reloadKey, String(Date.now()))
    } catch {
      return
    }
    event.preventDefault()
    window.location.reload()
  })

  if (!("serviceWorker" in navigator)) return
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
        updateViaCache: "none",
      })
      .then((registration) => {
        const check = () => void registration.update().catch(() => undefined)
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") check()
        })
        window.setInterval(check, updateCheckMs)
      })
      .catch(() => undefined)
  })
}
