import { useLayoutEffect } from "react"

import { usePageTransitionReady } from "@/components/page-transition-ready"

import { InventoryView } from "./inventory-view"
import { useInventoryController } from "./use-inventory-controller"

export function Inventory() {
  const controller = useInventoryController()

  useLayoutEffect(() => {
    document.documentElement.classList.add("inventory-route")
    return () => document.documentElement.classList.remove("inventory-route")
  }, [])

  usePageTransitionReady(!controller.busy || Boolean(controller.error))

  return <InventoryView controller={controller} />
}
