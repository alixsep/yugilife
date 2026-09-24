import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * Gives every public route its own HTML file, so search engines and link previews see a real page
 * with its own title, description, and canonical address instead of one shell for the whole app.
 *
 * Nothing here reaches the app bundle. The home page's head is injected into index.html (in dev as
 * well), and the build then writes a copy per route with that route's head swapped in, plus a
 * `<noscript>` body carrying the page's text, for crawlers that do not run JavaScript. Routes that
 * cannot be listed ahead of time, such as a saved card, fall through to 404.html, which is the same
 * app marked noindex.
 */

export const siteUrl = "https://alixsep.github.io/yugilife/"
const repositoryUrl = "https://github.com/alixsep/yugilife"
const author = {
  "@id": `${siteUrl}#author`,
  "@type": "Person",
  name: "Alixsep",
  sameAs: [
    "https://github.com/alixsep",
    "https://www.instagram.com/alixsepofficial/",
    "https://www.deviantart.com/alixsep",
  ],
  url: "https://github.com/alixsep",
}
const socialImage = {
  alt: "The Yugilife home page: create high quality Yu-Gi-Oh! cards.",
  height: 630,
  path: "social-card.jpg",
  width: 1200,
}

const home = {
  description:
    "Free, open-source Yu-Gi-Oh! card maker in your browser. Start from 14,000+ official cards, use full art layouts, and export PNG, JPEG, WebP or SVG.",
  path: "",
  title: "Yugilife: free, open-source Yu-Gi-Oh! card maker",
}

const blogDirectory = new URL("../src/content/blog/", import.meta.url)

async function loadPosts() {
  const entries = await readdir(blogDirectory, { withFileTypes: true })
  const posts = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const directory = new URL(`${entry.name}/`, blogDirectory)
        const { default: metadata } = await import(new URL("metadata.ts", directory).href)
        const source = await readFile(new URL("index.mdx", directory), "utf8")
        return { ...metadata, source }
      }),
  )
  return posts.sort((left, right) => right.date.localeCompare(left.date))
}

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")

const absoluteUrl = (href) => {
  if (!href.startsWith("/")) return href
  const path = href.slice(1).replace(/\/?$/, "/")
  return `${siteUrl}${path === "/" ? "" : path}`
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(
      /\[([^\]]+)\]\(([^)\s]+)\)/g,
      (_, label, href) => `<a href="${absoluteUrl(href)}">${label}</a>`,
    )
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])[*_]([^*_]+)[*_](?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
}

/**
 * The prose of a post as plain HTML. Interactive figures and charts are MDX components that only
 * exist in the app, so they are left out; everything a reader would quote is kept.
 */
function articleHtml(source) {
  const html = []
  const lines = source.replace(/\r\n/g, "\n").split("\n")
  let block = []

  const flush = () => {
    if (block.length === 0) return
    const first = block[0].trim()
    const joined = block.map((line) => line.trim()).join(" ")
    block = []
    if (/^(import|export)\s/.test(first) || /^[<{]/.test(first)) return
    const heading = /^(#{1,6})\s+(.*)$/.exec(first)
    if (heading) {
      const level = Math.max(2, heading[1].length)
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`)
    } else if (/^([-*]|\d+\.)\s/.test(first)) {
      const ordered = /^\d+\./.test(first)
      const items = joined.split(/\s(?=(?:[-*]|\d+\.)\s)/)
      const tag = ordered ? "ol" : "ul"
      const list = items.map(
        (item) => `<li>${inlineMarkdown(item.replace(/^([-*]|\d+\.)\s+/, ""))}</li>`,
      )
      html.push(`<${tag}>${list.join("")}</${tag}>`)
    } else if (first.startsWith(">")) {
      html.push(
        `<blockquote><p>${inlineMarkdown(joined.replace(/(^|\s)>\s?/g, "$1"))}</p></blockquote>`,
      )
    } else if (first.startsWith("|")) {
      html.push(`<pre>${escapeHtml(block.join("\n"))}</pre>`)
    } else {
      html.push(`<p>${inlineMarkdown(joined)}</p>`)
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fence = /^\s*(```+|~~~+)/.exec(line)
    if (fence) {
      flush()
      const code = []
      for (
        index += 1;
        index < lines.length && !lines[index].trim().startsWith(fence[1]);
        index += 1
      ) {
        code.push(lines[index])
      }
      html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`)
    } else if (line.trim() === "") {
      flush()
    } else {
      block.push(line)
    }
  }
  flush()
  return html.join("\n")
}

const jsonLd = (value) =>
  `<script type="application/ld+json">${JSON.stringify(value).replaceAll("<", "\\u003c")}</script>`

function head(page) {
  const url = `${siteUrl}${page.path}`
  const image = `${siteUrl}${socialImage.path}`
  const tags = [
    `<title>${escapeHtml(page.title)}</title>`,
    `<meta name="description" content="${escapeHtml(page.description)}" />`,
    page.noindex
      ? `<meta name="robots" content="noindex" />`
      : `<link rel="canonical" href="${url}" />`,
    `<meta property="og:site_name" content="Yugilife" />`,
    `<meta property="og:type" content="${page.article ? "article" : "website"}" />`,
    `<meta property="og:title" content="${escapeHtml(page.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="${socialImage.width}" />`,
    `<meta property="og:image:height" content="${socialImage.height}" />`,
    `<meta property="og:image:alt" content="${escapeHtml(socialImage.alt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ]
  if (page.article) {
    tags.push(`<meta property="article:published_time" content="${page.article.date}" />`)
  }
  if (page.structuredData) tags.push(jsonLd(page.structuredData))
  return `<!-- seo:start -->\n${tags.map((tag) => `    ${tag}`).join("\n")}\n    <!-- seo:end -->`
}

function body(page) {
  return `<noscript>\n<main>\n${page.content}\n</main>\n</noscript>`
}

function pages(posts) {
  const postLinks = posts
    .map((post) => `<li><a href="${siteUrl}blog/${post.slug}/">${escapeHtml(post.title)}</a></li>`)
    .join("")
  const homePage = {
    ...home,
    content: [
      `<h1>Create high quality Yu-Gi-Oh! cards</h1>`,
      `<p>${escapeHtml(home.description)}</p>`,
      `<p><a href="${siteUrl}build/">Open the card builder</a> · <a href="${siteUrl}blog/">Blog</a> · <a href="${repositoryUrl}">Source code on GitHub</a></p>`,
      `<h2>From the blog</h2>`,
      `<ul>${postLinks}</ul>`,
    ].join("\n"),
    structuredData: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@id": `${siteUrl}#website`,
          "@type": "WebSite",
          description: home.description,
          name: "Yugilife",
          publisher: { "@id": author["@id"] },
          url: siteUrl,
        },
        {
          "@type": "WebApplication",
          applicationCategory: "DesignApplication",
          author: { "@id": author["@id"] },
          browserRequirements: "Requires JavaScript",
          description: home.description,
          image: `${siteUrl}${socialImage.path}`,
          isAccessibleForFree: true,
          name: "Yugilife",
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          operatingSystem: "Any",
          url: siteUrl,
        },
        {
          "@type": "SoftwareSourceCode",
          author: { "@id": author["@id"] },
          codeRepository: repositoryUrl,
          license: "https://www.gnu.org/licenses/agpl-3.0.html",
          name: "Yugilife",
          programmingLanguage: "TypeScript",
          url: repositoryUrl,
        },
        author,
      ],
    },
  }

  return [
    homePage,
    {
      content: `<h1>Yu-Gi-Oh! card builder</h1>\n<p>${escapeHtml("Design a custom Yu-Gi-Oh! card in your browser. This page needs JavaScript.")}</p>`,
      description:
        "Design a custom Yu-Gi-Oh! card: every frame, Pendulum and Link, full art, rich text, and exports up to 8x. Runs in your browser with no account.",
      path: "build/",
      title: "Yu-Gi-Oh! card builder · Yugilife",
    },
    {
      content: `<h1>Inventory</h1>\n<p>Your saved cards. This page needs JavaScript.</p>`,
      description: "The cards you have saved in this browser.",
      noindex: true,
      path: "inventory/",
      title: "Inventory · Yugilife",
    },
    {
      content: `<h1>Yugilife blog</h1>\n<p>Releases, updates, and notes about Yugilife.</p>\n<ul>${postLinks}</ul>`,
      description:
        "Release notes and articles about Yugilife, the open-source Yu-Gi-Oh! card maker.",
      path: "blog/",
      title: "Blog · Yugilife",
    },
    ...posts.map((post) => ({
      article: post,
      content: `<article>\n<h1>${escapeHtml(post.title)}</h1>\n<p><time datetime="${post.date}">${post.date}</time> · Alixsep</p>\n${articleHtml(post.source)}\n</article>`,
      description: post.excerpt,
      path: `blog/${post.slug}/`,
      structuredData: {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        author,
        datePublished: post.date,
        description: post.excerpt,
        headline: post.title,
        image: `${siteUrl}${socialImage.path}`,
        isPartOf: { "@id": `${siteUrl}#website` },
        mainEntityOfPage: `${siteUrl}blog/${post.slug}/`,
        url: `${siteUrl}blog/${post.slug}/`,
      },
      title: `${post.title} · Yugilife`,
    })),
  ]
}

function sitemap(routes) {
  const urls = routes
    .filter((page) => !page.noindex)
    .map((page) => {
      const lastmod = page.article ? `<lastmod>${page.article.date}</lastmod>` : ""
      return `  <url><loc>${siteUrl}${page.path}</loc>${lastmod}</url>`
    })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`
}

const seoBlock = /<!-- seo:start -->[\s\S]*?<!-- seo:end -->/
const noscriptBlock = /<noscript>\n<main>[\s\S]*?<\/main>\n<\/noscript>/

/** @returns {import("vite").Plugin} */
export function yugilifeSeoPages() {
  let outDir = "dist"
  let routes

  const loadRoutes = async () => (routes ??= pages(await loadPosts()))

  return {
    name: "yugilife-seo-pages",

    configResolved(config) {
      outDir = config.build.outDir
    },

    async transformIndexHtml(html) {
      const [homePage] = await loadRoutes()
      return html
        .replace("<!-- seo -->", head(homePage))
        .replace('<div id="root"></div>', `<div id="root"></div>\n    ${body(homePage)}`)
    },

    async closeBundle() {
      if (this.meta.watchMode) return
      const [homePage, ...others] = await loadRoutes()
      const shell = await readFile(join(outDir, "index.html"), "utf8")
      const render = (page) =>
        shell.replace(seoBlock, head(page).trim()).replace(noscriptBlock, body(page))

      for (const page of others) {
        const directory = join(outDir, page.path)
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, "index.html"), render(page))
      }
      await writeFile(
        join(outDir, "404.html"),
        render({
          ...homePage,
          content: "<h1>Page not found</h1>",
          noindex: true,
          structuredData: undefined,
        }),
      )
      await writeFile(join(outDir, "sitemap.xml"), sitemap([homePage, ...others]))
    },
  }
}
