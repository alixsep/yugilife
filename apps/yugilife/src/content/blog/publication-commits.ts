const commitPattern = /^[a-f0-9]{40}$/
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const publicationCommits = new Map<string, string>()
for (const [slug, commit] of Object.entries(__YUGILIFE_BLOG_PUBLICATION_COMMITS__)) {
  if (slugPattern.test(slug) && commitPattern.test(commit)) publicationCommits.set(slug, commit)
}

export function getBlogPublicationCommit(slug: string) {
  return publicationCommits.get(slug)
}
