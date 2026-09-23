interface BlogPostMetadataBase {
  readonly slug: string
  readonly title: string
  readonly date: string
  readonly excerpt: string
}

export interface ArticlePostMetadata extends BlogPostMetadataBase {
  readonly kind: "article"
}

export interface ReleasePostMetadata extends BlogPostMetadataBase {
  readonly kind: "release"
  readonly version?: string
}

export type BlogPostMetadata = ArticlePostMetadata | ReleasePostMetadata
