import { createContext, useContext, useLayoutEffect } from "react"

export interface PageTransitionReadyContextValue {
  setReady: (ready: boolean) => void
}

export const PageTransitionReadyContext = createContext<PageTransitionReadyContextValue>({
  setReady: () => undefined,
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
