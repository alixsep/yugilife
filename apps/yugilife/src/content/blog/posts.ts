import ReturnAfterSixYears from "./return-after-six-years/index.mdx"
import returnAfterSixYearsMetadata from "./return-after-six-years/metadata"
import YugilifeIsNowOpenSource from "./yugilife-is-now-open-source/index.mdx"
import yugilifeIsNowOpenSourceMetadata from "./yugilife-is-now-open-source/metadata"

import type { BlogPostMetadata } from "./types"
import type { AnchorHTMLAttributes, ComponentType } from "react"

export interface BlogPostComponentProps {
  readonly components?: {
    readonly a?: ComponentType<AnchorHTMLAttributes<HTMLAnchorElement>>
  }
}

export interface BlogPost extends BlogPostMetadata {
  readonly Component: ComponentType<BlogPostComponentProps>
}

const sourcePosts: readonly BlogPost[] = [
  { ...returnAfterSixYearsMetadata, Component: ReturnAfterSixYears },
  { ...yugilifeIsNowOpenSourceMetadata, Component: YugilifeIsNowOpenSource },
]

export const blogPosts = [...sourcePosts].sort((left, right) => right.date.localeCompare(left.date))

export function getBlogPost(slug: string | undefined) {
  return blogPosts.find((post) => post.slug === slug)
}

export function getAdjacentBlogPosts(slug: string) {
  const index = blogPosts.findIndex((post) => post.slug === slug)
  if (index < 0) return { next: undefined, previous: undefined }

  return {
    // The list is newest first, so the previous post is the older one.
    next: index === 0 ? undefined : blogPosts[index - 1],
    previous: index === blogPosts.length - 1 ? undefined : blogPosts[index + 1],
  }
}
