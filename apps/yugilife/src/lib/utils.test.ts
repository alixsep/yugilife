import { describe, expect, it } from "vitest"

import { cn } from "./utils"

describe("cn", () => {
  it("treats the type-scale roles as sizes, so a colour beside them survives", () => {
    expect(cn("text-body", "text-foreground")).toBe("text-body text-foreground")
    expect(cn("text-body", "text-caption")).toBe("text-caption")
    expect(cn("text-body", "text-[13px]")).toBe("text-[13px]")
  })

  it("treats the surface ladder as shadows, so overriding one actually removes it", () => {
    expect(cn("shadow-surface-1", "shadow-none")).toBe("shadow-none")
    expect(cn("shadow-surface-1", "shadow-surface-3")).toBe("shadow-surface-3")
    expect(cn("shadow-surface-4", "shadow-md")).toBe("shadow-md")
  })

  it("leaves a surface background to the colour group it belongs to", () => {
    expect(cn("bg-surface-2", "bg-transparent")).toBe("bg-transparent")
  })
})
