import { StrictMode } from "react"

import { createRoot } from "react-dom/client"

import { registerServiceWorker } from "./lib/service-worker"
import App from "./app"

import "./index.css"

registerServiceWorker()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
