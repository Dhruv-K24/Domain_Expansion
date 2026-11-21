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

const CACHE = 'jjk-domains-2da9be2c5d'
const FILES = ["./art/coffin/bg.jpg","./assets/main-Dh5NbWHC.css","./assets/main-S4AHtGh5.js","./favicon.svg","./icon.svg","./icons.svg","./index.html","./manifest.webmanifest","./mediapipe-wasm/vision_wasm_internal.js","./mediapipe-wasm/vision_wasm_internal.wasm","./mediapipe-wasm/vision_wasm_module_internal.js","./mediapipe-wasm/vision_wasm_module_internal.wasm","./phone.html","./signs.json"]   // everything in the built app (relative to this file)
const MODELS = ["https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task","https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite","https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"] // AI models hosted by Google

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    // FAST UPDATES: the AI engine (mediapipe-wasm/, ~28MB) and the AI models (~12MB) never change
    // between our builds, so if the phone already saved them in an older version, COPY them over
    // instead of downloading again. An update then only downloads the small changed files (~2.5MB).
    const reusable = (url) => url.includes('/mediapipe-wasm/') || MODELS.includes(url)
    const reuse = async (url) => {
      if (!reusable(new URL(url, location.href).href) && !reusable(url)) return false
      const old = await caches.match(url) // searches the older versions' caches too
      if (!old) return false
      await cache.put(url, old)
      return true
    }
    for (const f of FILES) {
      if (await reuse(f)) continue
      // cache: 'reload' = ALWAYS download from the server, never a file the browser remembered
      // (GitHub lets browsers reuse files for 10 min: the "new" version could get old files)
      const res = await fetch(new Request(f, { cache: 'reload' }))
      if (!res.ok) throw new Error(`download failed: ${f} (${res.status})`)
      await cache.put(f, res)
    }
    // models live on another server: one failure shouldn't break the whole install
    await Promise.allSettled(MODELS.map(async (url) => {
      if (await reuse(url)) return
      await cache.add(new Request(url, { mode: 'cors' }))
    }))
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
