import { lazy, Suspense } from "react"

import { ArrowLeft, ArrowRight } from "lucide-react"
import { Link, Navigate, useParams } from "react-router"

import { Button } from "@/components/ui/button"
import BlogIndexIntro from "@/content/blog/index.mdx"
import { blogPosts, getAdjacentBlogPosts, getBlogPost } from "@/content/blog/posts"
import { useAccentColorContext } from "@/lib/accent-color-context"

import type { AnchorHTMLAttributes, CSSProperties, ReactNode } from "react"

const AppNavigation = lazy(() =>
  import("@/components/app-navigation").then((module) => ({ default: module.AppNavigation })),
)

const blogDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  year: "numeric",
})
const blogShortDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
})

function formatBlogDate(date: string) {
  return blogDateFormatter.format(new Date(`${date}T00:00:00Z`))
}

function formatBlogShortDate(date: string) {
  return blogShortDateFormatter.format(new Date(`${date}T00:00:00Z`)).toUpperCase()
}

function BlogLayout({ children }: { children: ReactNode }) {
  const { accentColor } = useAccentColorContext()

  return (
    <main className="bg-background text-foreground flex min-h-dvh flex-col">
      <Suspense fallback={<div aria-hidden="true" className="h-12 shrink-0" />}>
        <AppNavigation />
      </Suspense>
      <div className="mx-auto flex w-full max-w-[900px] flex-1 justify-center px-5 py-14 sm:px-8 sm:py-20">
        <article
          className="[&_code]:bg-muted [&_figcaption]:text-muted-foreground [&_li]:text-muted-foreground [&_p]:text-muted-foreground [&_pre]:bg-muted [&_code]:text-foreground [&_img]:border-border [&_pre]:border-border w-full max-w-[68ch] text-left [&_code]:rounded-sm [&_code]:box-decoration-clone [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] [&_figcaption]:mt-2 [&_figcaption]:text-center [&_figcaption]:text-sm [&_figure]:my-12 [&_h1]:mt-0 [&_h1]:max-w-[18ch] [&_h1]:text-[clamp(2.35rem,6vw,3.65rem)] [&_h1]:leading-[1.04] [&_h1]:font-medium [&_h1]:tracking-[-0.045em] [&_h1]:text-balance [&_h2]:mt-14 [&_h2]:text-2xl [&_h2]:font-medium [&_h2]:tracking-[-0.02em] [&_h2]:text-balance [&_h3]:mt-10 [&_h3]:text-xl [&_h3]:font-medium [&_h3]:text-balance [&_img]:mx-auto [&_img]:max-h-[70vh] [&_img]:w-full [&_img]:rounded-lg [&_img]:border [&_li]:mt-2 [&_p]:mt-6 [&_p]:leading-8 [&_pre]:mt-8 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:p-4 [&_pre]:text-[0.8125rem] [&_pre]:leading-6 [&_pre]:[overflow-wrap:anywhere] [&_pre]:whitespace-pre-wrap [&_pre_code]:rounded-none [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit [&_ul]:mt-6 [&_ul]:list-disc [&_ul]:pl-6"
          style={{ "--blog-accent": accentColor } as CSSProperties}
        >
          {children}
        </article>
      </div>
    </main>
  )
}

export function BlogIndexPage() {
  return (
    <BlogLayout>
      <BlogIndexIntro />
      <ol aria-label="Blog posts" className="mt-16 list-none p-0">
        {blogPosts.map((post, index) => (
          <li key={post.slug} className="text-foreground relative !mt-0 pb-12 pl-[72px] last:pb-0">
            {index < blogPosts.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute top-4 -bottom-4 left-[27px] w-0.5 bg-(--blog-accent)"
              />
            ) : null}
            <time
              dateTime={post.date}
              className="absolute top-1 left-0 z-10 w-14 rounded-md border-2 bg-(--blog-accent) px-0.5 py-0.5 text-center text-[11px] leading-4 font-bold tracking-[0.05em] text-white"
              style={{ borderColor: "var(--blog-accent)" }}
            >
              {formatBlogShortDate(post.date)}
            </time>
            <Link
              to={`/blog/${post.slug}`}
              className="group block rounded-sm no-underline outline-none focus-visible:ring-2 focus-visible:ring-(--blog-accent) focus-visible:ring-offset-4 focus-visible:ring-offset-(--background)"
            >
              <h2 className="text-foreground !mt-0 text-xl leading-snug font-medium tracking-tight text-balance transition-colors group-hover:text-(--blog-accent)">
                {post.title}
              </h2>
              <p className="text-muted-foreground !mt-2 max-w-[60ch] leading-6 text-pretty">
                {post.excerpt}
              </p>
            </Link>
          </li>
        ))}
      </ol>
    </BlogLayout>
  )
}

function BlogPostNavigation({ slug }: { slug: string }) {
  const { next, previous } = getAdjacentBlogPosts(slug)
  if (!next && !previous) return null

  return (
    <nav
      aria-label="Blog post navigation"
      className="border-border mt-20 grid grid-cols-2 gap-6 border-t pt-6 sm:gap-10"
    >
      {previous ? <BlogPostNavigationLink direction="previous" post={previous} /> : <span />}
      {next ? <BlogPostNavigationLink direction="next" post={next} /> : <span />}
    </nav>
  )
}

function BlogPostNavigationLink({
  direction,
  post,
}: {
  direction: "next" | "previous"
  post: (typeof blogPosts)[number]
}) {
  const isPrevious = direction === "previous"
  const label = isPrevious ? "Previous post" : "Next post"
  const Arrow = isPrevious ? ArrowLeft : ArrowRight

  return (
    <Link
      to={`/blog/${post.slug}`}
      aria-label={`${label}: ${post.title}`}
      className={`group flex min-w-0 flex-col gap-1 rounded-sm no-underline outline-none focus-visible:ring-2 focus-visible:ring-(--blog-accent) focus-visible:ring-offset-4 focus-visible:ring-offset-(--background) ${isPrevious ? "items-start text-left" : "items-end text-right"}`}
    >
      <span className="flex items-center gap-1.5 text-sm text-(--blog-accent)">
        {isPrevious ? <Arrow aria-hidden="true" className="size-4" /> : null}
        {label}
        {!isPrevious ? <Arrow aria-hidden="true" className="size-4" /> : null}
      </span>
      <span className="text-muted-foreground group-hover:text-foreground line-clamp-2 text-sm [overflow-wrap:anywhere] transition-colors">
        {post.title}
      </span>
    </Link>
  )
}

function BlogContentLink({
  children,
  className,
  href = "",
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const linkClassName = `font-medium text-(--blog-accent) underline decoration-current/40 underline-offset-4 transition-[text-decoration-color] hover:decoration-current ${className ?? ""}`

  if (href.startsWith("/") && !href.startsWith("//")) {
    return (
      <Link {...props} className={linkClassName} to={href}>
        {children}
      </Link>
    )
  }

  const isExternal = /^https?:\/\//i.test(href)

  return (
    <a
      {...props}
      className={linkClassName}
      href={href}
      {...(isExternal ? { rel: "noopener noreferrer", target: "_blank" } : {})}
    >
      {children}
      {isExternal ? <span className="sr-only"> (opens in a new tab)</span> : null}
    </a>
  )
}

const blogContentComponents = { a: BlogContentLink }

export function BlogPostPage() {
  const { slug } = useParams()
  const post = getBlogPost(slug)

  if (!post) return <Navigate to="/blog" replace />

  const Post = post.Component

  return (
    <BlogLayout>
      <Button
        asChild
        className="mb-10 -ml-3"
        leadingIcon={ArrowLeft}
        variant="ghost"
        style={{ color: "var(--blog-accent)" }}
      >
        <Link to="/blog">Back to blog</Link>
      </Button>
      <header className="mb-12">
        <h1>{post.title}</h1>
        <time className="text-muted-foreground mt-5 block text-sm" dateTime={post.date}>
          {formatBlogDate(post.date)}
        </time>
      </header>
      <div className="[&_a]:[overflow-wrap:anywhere] [&_h2]:[overflow-wrap:break-word] [&_h3]:[overflow-wrap:break-word] [&_p]:[overflow-wrap:anywhere] [&_p]:[hyphens:auto] sm:[&_p]:text-justify">
        <Post components={blogContentComponents} />
      </div>
      <BlogPostNavigation slug={post.slug} />
    </BlogLayout>
  )
}
