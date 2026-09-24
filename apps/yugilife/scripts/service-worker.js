// Yugilife's service worker. The build replaces __YUGILIFE_BUILD__ with a hash of its output, so
// every deploy ships a new worker that takes over at once and drops the previous build's caches.
//
// Pages always come from the network when it answers, revalidated past any HTTP cache, so a load
// always runs the latest deploy; the copy kept here is only for when the network is gone. Hashed
// build files never change once built, so they are served from the cache. Everything else, such as
// the card catalog and the template caches the app manages itself, is left alone.

const build = "__YUGILIFE_BUILD__"
const pageCache = `yugilife-sw-pages-${build}`
const assetCache = `yugilife-sw-assets-${build}`
const scope = new URL(self.registration.scope)
const assetPrefix = new URL("assets/", scope).pathname
const hashedFile = /-[\w-]{8}\.\w+$/

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(pageCache)
      .then((cache) => cache.add(scope.href))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("yugilife-sw-") && name !== pageCache && name !== assetCache) {
          await caches.delete(name)
        }
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return
  const url = new URL(request.url)
  if (url.origin !== scope.origin) return
  if (request.mode === "navigate") {
    event.respondWith(page(request))
  } else if (url.pathname.startsWith(assetPrefix) && hashedFile.test(url.pathname)) {
    event.respondWith(asset(request))
  }
})

async function page(request) {
  const cache = await caches.open(pageCache)
  try {
    const response = await fetch(request.url, { cache: "no-cache", credentials: "same-origin" })
    // A navigation may not be answered with a redirected response, so a directory redirect
    // (/blog to /blog/) is handed back as a plain copy of where it landed.
    const answer = response.redirected ? new Response(response.body, response) : response
    if (answer.ok) await cache.put(request.url, answer.clone())
    return answer
  } catch {
    return (await cache.match(request.url)) ?? (await cache.match(scope.href)) ?? Response.error()
  }
}

async function asset(request) {
  const cache = await caches.open(assetCache)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}
