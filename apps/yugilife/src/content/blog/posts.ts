import FullArtCardSearchAndMore from "./full-art-autocomplete-and-more/index.mdx"
import fullArtCardSearchAndMoreMetadata from "./full-art-autocomplete-and-more/metadata"
import GeneratingAlphaMasks from "./generating-alpha-masks-for-yugioh-artworks/index.mdx"
import generatingAlphaMasksMetadata from "./generating-alpha-masks-for-yugioh-artworks/metadata"
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

export type BlogPost = BlogPostMetadata & {
  readonly Component: ComponentType<BlogPostComponentProps>
}

const sourcePosts: readonly BlogPost[] = [
  { ...returnAfterSixYearsMetadata, Component: ReturnAfterSixYears },
  { ...yugilifeIsNowOpenSourceMetadata, Component: YugilifeIsNowOpenSource },
  { ...fullArtCardSearchAndMoreMetadata, Component: FullArtCardSearchAndMore },
  { ...generatingAlphaMasksMetadata, Component: GeneratingAlphaMasks },
]

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/
const semanticVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

function isValidDate(value: string) {
  if (!isoDatePattern.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

function validatePosts(posts: readonly BlogPost[]) {
  const slugs = new Set<string>()
  const releaseVersions = new Set<string>()
  for (const post of posts) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(post.slug) || slugs.has(post.slug)) {
      throw new Error(`Blog post slug is invalid or duplicated: ${post.slug}`)
    }
    slugs.add(post.slug)
    if (!isValidDate(post.date)) {
      throw new Error(`Blog post date is invalid: ${post.date}`)
    }
    if (post.kind === "release" && post.version !== undefined) {
      if (!semanticVersionPattern.test(post.version) || releaseVersions.has(post.version)) {
        throw new Error(`Blog release version is invalid or duplicated: ${post.version}`)
      }
      releaseVersions.add(post.version)
    }
  }
}

validatePosts(sourcePosts)

export const blogPosts = [...sourcePosts].sort((left, right) => right.date.localeCompare(left.date))
export const blogPageSize = 10

export function getBlogPage(pageNumber: number) {
  const pageCount = Math.max(1, Math.ceil(blogPosts.length / blogPageSize))
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
    return undefined
  }
  const start = (pageNumber - 1) * blogPageSize
  return {
    pageCount,
    pageNumber,
    posts: blogPosts.slice(start, start + blogPageSize),
  }
}

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
