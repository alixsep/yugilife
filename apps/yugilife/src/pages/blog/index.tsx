import { AppNavigation } from "@/components/app-navigation"

import type { ReactNode } from "react"

export function Blog({ content }: { content: ReactNode }) {
  return (
    <main className="bg-background text-foreground flex min-h-dvh flex-col">
      <AppNavigation />
      <div className="mx-auto flex w-full max-w-[1920px] flex-1 items-center justify-center p-4 sm:p-6">
        <article className="[&_p]:text-muted-foreground text-center [&_h1]:text-4xl [&_h1]:font-semibold [&_p]:mt-3 [&_p]:text-sm">
          {content}
        </article>
      </div>
    </main>
  )
}
