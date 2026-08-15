type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> }
}

/**
 * Cross-fade an application-wide appearance change using a pair of compositor
 * snapshots. Browsers without View Transitions, and users who prefer reduced
 * motion, get the update immediately.
 */
export function runAppearanceTransition(update: () => void) {
  if (typeof document === "undefined") {
    update()
    return
  }

  const transitionDocument = document as ViewTransitionDocument
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches

  if (!transitionDocument.startViewTransition || prefersReducedMotion) {
    update()
    return
  }

  const transition = transitionDocument.startViewTransition(update)
  void transition.finished.catch(() => {
    // A newer appearance update can supersede an in-flight transition.
  })
}
