import { lazy, Suspense, useCallback, useState } from "react"

import { BrowserRouter, HashRouter, Route, Routes } from "react-router"

import { ShapeProvider } from "@/lib/shape-context"
import { ThemeProvider } from "@/lib/theme-context"

import { CustomCursor } from "./components/custom-cursor"
import { LogoLoadingScreen } from "./components/logo-loading-screen"
import { PageTransition } from "./components/page-transition"
import { usePageTransitionReady } from "./components/page-transition-ready"
import { AccentColorProvider } from "./lib/accent-color-context"
import { BlogIndexPage, BlogPostPage } from "./pages/blog"

const Build = lazy(() => import("./pages/build").then((module) => ({ default: module.Build })))
const Home = lazy(() => import("./pages/home").then((module) => ({ default: module.Home })))
const Inventory = lazy(() =>
  import("./pages/inventory").then((module) => ({ default: module.Inventory })),
)

function RouteLoadingFallback() {
  usePageTransitionReady(false)

  return (
    <main
      aria-label="Loading page"
      aria-live="polite"
      className="bg-background min-h-dvh"
      role="status"
    />
  )
}

export default function App() {
  const usesHashRouting = import.meta.env.BASE_URL !== "/"
  const Router = usesHashRouting ? HashRouter : BrowserRouter
  const routePath = usesHashRouting
    ? window.location.hash.slice(1).split(/[?#]/, 1)[0] || "/"
    : window.location.pathname
  const landingEntry = routePath === "/"
  const [startupComplete, setStartupComplete] = useState(
    () => document.documentElement.dataset.loadingComplete === "true",
  )
  const [landingPreparing, setLandingPreparing] = useState(false)
  const [landingReady, setLandingReady] = useState(false)
  const prepareLanding = useCallback(() => setLandingPreparing(true), [])
  const completeStartup = useCallback(() => setStartupComplete(true), [])
  const completeLanding = useCallback(() => setLandingReady(true), [])
  const showApplication = startupComplete || !landingEntry || landingPreparing

  return (
    <ThemeProvider>
      <AccentColorProvider>
        {!startupComplete && (
          <LogoLoadingScreen
            onComplete={completeStartup}
            readyToExit={!landingEntry || landingReady}
            {...(landingEntry ? { onPrepare: prepareLanding } : {})}
          />
        )}
        {showApplication && (
          <>
            <CustomCursor />
            <ShapeProvider>
              <Router>
                <PageTransition>
                  {(displayLocation) => (
                    <Suspense fallback={<RouteLoadingFallback />}>
                      <Routes location={displayLocation}>
                        <Route index element={<Home onReady={completeLanding} />} />
                        <Route path="build" element={<Build />} />
                        <Route path="build/:cardId" element={<Build />} />
                        <Route path="inventory" element={<Inventory />} />
                        <Route path="blog" element={<BlogIndexPage />} />
                        <Route path="blog/:slug" element={<BlogPostPage />} />
                      </Routes>
                    </Suspense>
                  )}
                </PageTransition>
              </Router>
            </ShapeProvider>
          </>
        )}
      </AccentColorProvider>
    </ThemeProvider>
  )
}
