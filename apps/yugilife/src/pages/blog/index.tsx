import { lazy, Suspense } from "react"

import { ArrowLeft, ArrowRight, GitCommit } from "lucide-react"
import { Link, Navigate, useParams, useSearchParams } from "react-router"

import { ReleaseFlag } from "@/components/release-flag"
import { Button } from "@/components/ui/button"
import BlogIndexIntro from "@/content/blog/index.mdx"
import { getAdjacentBlogPosts, getBlogPage, getBlogPost } from "@/content/blog/posts"
import { getBlogPublicationCommit } from "@/content/blog/publication-commits"

import type { BlogPost } from "@/content/blog/posts"
import type { BlogPostMetadata } from "@/content/blog/types"
import type { AnchorHTMLAttributes, ReactNode } from "react"

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

function ReleaseTag({
  placement,
  post,
}: {
  placement: "article" | "timeline"
  post: BlogPostMetadata
}) {
  if (post.kind !== "release") return null

  const label = `Release${post.version ? ` v${post.version}` : ""}`

  if (placement === "article") {
    const commit = getBlogPublicationCommit(post.slug)

    if (commit) {
      const shortCommit = commit.slice(0, 7)

      return (
        <a
          aria-label={`View release commit ${shortCommit} on GitHub`}
          className="text-caption inline-flex shrink-0 items-center gap-1.5 rounded-md bg-(--user-accent) px-2 py-1 leading-none font-medium tracking-wide whitespace-nowrap text-(--user-accent-foreground) uppercase no-underline transition-opacity outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-(--user-accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--background)"
          href={`https://github.com/alixsep/yugilife/commit/${commit}`}
          rel="noreferrer"
          target="_blank"
          title={`Release commit ${commit}`}
        >
          <span>{label}</span>
          <GitCommit aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="font-mono leading-none tracking-normal normal-case">{shortCommit}</span>
        </a>
      )
    }

    return (
      <span className="text-caption inline-flex shrink-0 items-center rounded-md bg-(--user-accent) px-2 py-1 leading-none font-medium tracking-wide whitespace-nowrap text-(--user-accent-foreground) uppercase">
        {label}
      </span>
    )
  }

  return (
    <ReleaseFlag className="ml-1 translate-x-0.5 -translate-y-[1.5px] align-middle" label={label} />
  )
}

/**
 * A post title with its release flag at the end of it.
 *
 * The flag is inside the heading rather than beside it, so the line breaker treats it as one more
 * word in the sentence: it follows the last word when there is room and moves down on its own when
 * there is not. As a sibling of the heading it could only ever sit under the whole title.
 */
function TimelineTitle({ post }: { post: BlogPostMetadata }) {
  if (post.kind !== "release") return post.title

  return (
    <>
      {post.title} <ReleaseTag placement="timeline" post={post} />
    </>
  )
}

function parsePageNumber(value: string | null) {
  if (value === null) return 1
  if (!/^[1-9]\d*$/.test(value)) return undefined
  const page = Number(value)
  return Number.isSafeInteger(page) ? page : undefined
}

function blogPageUrl(page: number) {
  return page === 1 ? "/blog" : `/blog?page=${page}`
}

function BlogLayout({ children }: { children: ReactNode }) {
  return (
    <main className="bg-background text-foreground flex min-h-dvh flex-col">
      <Suspense fallback={<div aria-hidden="true" className="h-12 shrink-0" />}>
        <AppNavigation />
      </Suspense>
      <div className="mx-auto flex w-full max-w-[900px] flex-1 justify-center px-5 py-14 sm:px-8 sm:py-20">
        <article className="[&_code]:bg-muted [&_figcaption]:text-muted-foreground [&_li]:text-muted-foreground [&_p]:text-muted-foreground [&_pre]:bg-muted [&_code]:text-foreground [&_img]:border-border [&_pre]:border-border [&_figcaption]:text-subtitle [&_pre]:text-body w-full max-w-[68ch] text-left [&_code]:rounded-sm [&_code]:box-decoration-clone [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] [&_figcaption]:mt-2 [&_figcaption]:text-center [&_figure]:my-12 [&_h1]:mt-0 [&_h1]:max-w-[18ch] [&_h1]:text-[clamp(2.35rem,6vw,3.65rem)] [&_h1]:leading-[1.04] [&_h1]:font-medium [&_h1]:tracking-[-0.045em] [&_h1]:text-balance [&_h2]:mt-14 [&_h2]:text-2xl [&_h2]:font-medium [&_h2]:tracking-[-0.02em] [&_h2]:text-balance [&_h3]:mt-10 [&_h3]:text-xl [&_h3]:font-medium [&_h3]:text-balance [&_img]:mx-auto [&_img]:max-h-[70vh] [&_img]:w-full [&_img]:rounded-lg [&_img]:border [&_li]:mt-2 [&_p]:mt-6 [&_p]:leading-8 [&_pre]:mt-8 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:p-4 [&_pre]:leading-6 [&_pre]:[overflow-wrap:anywhere] [&_pre]:whitespace-pre-wrap [&_pre_code]:rounded-none [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit [&_ul]:mt-6 [&_ul]:list-disc [&_ul]:pl-6">
          {children}
        </article>
      </div>
    </main>
  )
}

export function BlogIndexPage() {
  const [searchParams] = useSearchParams()
  const requestedPage = parsePageNumber(searchParams.get("page"))
  const page = requestedPage === undefined ? undefined : getBlogPage(requestedPage)
  if (!page) return <Navigate to="/blog" replace />

  return (
    <BlogLayout>
      <BlogIndexIntro />
      <ol aria-label="Blog posts" className="mt-16 list-none p-0">
        {page.posts.map((post, index) => (
          <li key={post.slug} className="text-foreground relative !mt-0 pb-12 pl-[72px] last:pb-0">
            {index < page.posts.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute top-4 -bottom-4 left-[27px] w-0.5 bg-(--user-accent)"
              />
            ) : null}
            <time
              dateTime={post.date}
              className="text-caption absolute top-1 left-0 z-10 w-14 rounded-md border-2 bg-(--user-accent) px-0.5 py-0.5 text-center leading-4 font-bold tracking-[0.05em] text-(--user-accent-foreground)"
              style={{ borderColor: "var(--user-accent)" }}
            >
              {formatBlogShortDate(post.date)}
            </time>
            <Link
              to={`/blog/${post.slug}`}
              className="group block rounded-sm no-underline outline-none focus-visible:ring-2 focus-visible:ring-(--user-accent) focus-visible:ring-offset-4 focus-visible:ring-offset-(--background)"
            >
              <h2 className="text-foreground !mt-0 text-xl leading-snug font-medium tracking-tight text-balance transition-colors group-hover:text-(--user-accent)">
                <TimelineTitle post={post} />
              </h2>
              <p className="text-muted-foreground !mt-2 max-w-[60ch] leading-6 text-pretty">
                {post.excerpt}
              </p>
            </Link>
          </li>
        ))}
      </ol>
      {page.pageCount > 1 && (
        <nav
          aria-label="Blog pagination"
          className="border-border mt-12 grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t pt-6"
        >
          {page.pageNumber > 1 ? (
            <Button asChild leadingIcon={ArrowLeft} size="compact" variant="ghost">
              <Link to={blogPageUrl(page.pageNumber - 1)}>Newer</Link>
            </Button>
          ) : (
            <span />
          )}
          <span className="text-caption text-muted-foreground tabular-nums">
            Page {page.pageNumber} of {page.pageCount}
          </span>
          {page.pageNumber < page.pageCount ? (
            <Button
              asChild
              className="justify-self-end"
              size="compact"
              trailingIcon={ArrowRight}
              variant="ghost"
            >
              <Link to={blogPageUrl(page.pageNumber + 1)}>Older</Link>
            </Button>
          ) : (
            <span />
          )}
        </nav>
      )}
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
  post: BlogPost
}) {
  const isPrevious = direction === "previous"
  const label = isPrevious ? "Previous post" : "Next post"
  const Arrow = isPrevious ? ArrowLeft : ArrowRight

  return (
    <Link
      to={`/blog/${post.slug}`}
      aria-label={`${label}: ${post.title}`}
      className={`group flex min-w-0 flex-col gap-1 rounded-sm no-underline outline-none focus-visible:ring-2 focus-visible:ring-(--user-accent) focus-visible:ring-offset-4 focus-visible:ring-offset-(--background) ${isPrevious ? "items-start text-left" : "items-end text-right"}`}
    >
      <span className="text-subtitle flex items-center gap-1.5 text-(--user-accent)">
        {isPrevious ? <Arrow aria-hidden="true" className="size-4" /> : null}
        {label}
        {!isPrevious ? <Arrow aria-hidden="true" className="size-4" /> : null}
      </span>
      <span className="text-subtitle text-muted-foreground group-hover:text-foreground line-clamp-2 [overflow-wrap:anywhere] transition-colors">
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
  const linkClassName = `font-medium text-(--user-accent) underline decoration-current/40 underline-offset-4 transition-[text-decoration-color] hover:decoration-current ${className ?? ""}`

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
        className="hover:text-foreground mb-10 text-(--user-accent)"
        leadingIcon={ArrowLeft}
        variant="text"
      >
        <Link to="/blog">Back to blog</Link>
      </Button>
      <header className="mb-12">
        <h1>{post.title}</h1>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <ReleaseTag placement="article" post={post} />
          <time className="text-subtitle text-muted-foreground" dateTime={post.date}>
            {formatBlogDate(post.date)}
          </time>
        </div>
      </header>
      <div className="[&_a]:[overflow-wrap:anywhere] [&_h2]:[overflow-wrap:break-word] [&_h3]:[overflow-wrap:break-word] [&_p]:[overflow-wrap:anywhere] [&_p]:[hyphens:auto] sm:[&_p]:text-justify">
        <Post components={blogContentComponents} />
      </div>
      <BlogPostNavigation slug={post.slug} />
    </BlogLayout>
  )
}
