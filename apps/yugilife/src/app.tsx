import { useCallback, useState } from "react"

import { BrowserRouter, HashRouter, Route, Routes } from "react-router"

import { ShapeProvider } from "@/lib/shape-context"
import { ThemeProvider } from "@/lib/theme-context"

import { CustomCursor } from "./components/custom-cursor"
import { LogoLoadingScreen } from "./components/logo-loading-screen"
import { PageTransition } from "./components/page-transition"
import BlogIndex from "./content/blog/index.mdx"
import { AccentColorProvider } from "./lib/accent-color-context"
import { Blog } from "./pages/blog"
import { Build } from "./pages/build"
import { Home } from "./pages/home"
import { Inventory } from "./pages/inventory"

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
  const showApplication = startupComplete || (landingEntry && landingPreparing)

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
                    <Routes location={displayLocation}>
                      <Route index element={<Home onReady={completeLanding} />} />
                      <Route path="build" element={<Build />} />
                      <Route path="build/:cardId" element={<Build />} />
                      <Route path="inventory" element={<Inventory />} />
                      <Route path="blog" element={<Blog content={<BlogIndex />} />} />
                    </Routes>
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
