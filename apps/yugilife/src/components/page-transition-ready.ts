import { createContext, useContext, useLayoutEffect } from "react"

export interface PageTransitionReadyContextValue {
  setReady: (ready: boolean) => void
  transitioning: boolean
}

export const PageTransitionReadyContext = createContext<PageTransitionReadyContextValue>({
  setReady: () => undefined,
  transitioning: false,
})

/**
 * Route-level data loading can hold the reveal phase of the page transition.
 * Routes that render synchronously never need to call this hook.
 */
export function usePageTransitionReady(ready: boolean) {
  const { setReady } = useContext(PageTransitionReadyContext)

  useLayoutEffect(() => {
    setReady(ready)
    return () => setReady(true)
  }, [ready, setReady])
}

export function usePageTransitionInProgress() {
  return useContext(PageTransitionReadyContext).transitioning
}
