// Service worker — makes the app work OFFLINE.
//
// A service worker is a script the browser keeps installed alongside the app. It sits between
// the app and the network: every file the app asks for goes through its `fetch` handler, so it
// can answer from a saved copy (the CACHE) instead of the internet.
//
//   install:  save every file the app needs (app code, AI engine, AI models, signs, art)
//   activate: delete caches from older versions
//   fetch:    answer from the cache first; only go to the network for things not saved yet
//
// The build fills in __VERSION__, __FILES__ and __MODELS__ (see vite.config.ts), so a new
// build = a new version = the phone downloads the update next time it's online.

const CACHE = 'jjk-domains-__VERSION__'
const FILES = __FILES__   // everything in the built app (relative to this file)
const MODELS = __MODELS__ // AI models hosted by Google

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    // cache: 'reload' = ALWAYS download from the server. Without it the browser may hand back a
    // file it remembered earlier (GitHub lets browsers reuse files for 10 minutes), and the
    // "new" version would get saved with old files mixed in.
    await cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))
    // models are big and on another server: don't let one failure break the whole install
    await Promise.allSettled(MODELS.map((url) => cache.add(new Request(url, { mode: 'cors' }))))
    await self.skipWaiting() // use the new version right away
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return // recording/saving (POST) only exists on the laptop dev server
  const url = new URL(req.url)
  if (url.origin !== location.origin && url.hostname !== 'storage.googleapis.com') return
  if (url.pathname.includes('/api/')) return

  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    // ignoreSearch: "phone.html?x" still matches the saved "phone.html"
    const hit = await cache.match(req, { ignoreSearch: true })
    if (hit) return hit
    try {
      const res = await fetch(req)
      if (res.ok) cache.put(req, res.clone()) // save anything new for next time
      return res
    } catch (err) {
      // offline and not saved: for page loads, fall back to the phone page
      if (req.mode === 'navigate') {
        const page = await cache.match('./phone.html')
        if (page) return page
      }
      throw err
    }
  })())
})
