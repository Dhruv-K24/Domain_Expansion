// Art loader — lets a domain use real images when you provide them, and fall back to
// code-drawn visuals when you don't.
//
// Put files in  public/art/<domain>/  e.g.  public/art/coffin/bg.jpg
// Anything in /public is served next to the app, so that file is at <app>/art/coffin/bg.jpg.

const cache = new Map<string, Promise<HTMLImageElement | null>>()

function loadOne(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null) // missing file is fine: we just don't use it
    img.src = url
  })
}

/** Try `/art/<folder>/<name>.jpg|.png|.webp` in order; resolves to the first that exists, or null. */
export function loadArt(folder: string, name: string): Promise<HTMLImageElement | null> {
  const key = `${folder}/${name}`
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      for (const ext of ['jpg', 'png', 'webp', 'jpeg']) {
        const img = await loadOne(`${import.meta.env.BASE_URL}art/${folder}/${name}.${ext}`)
        if (img) return img
      }
      return null
    })())
  }
  return cache.get(key)!
}

/** draw an image to fill the canvas like CSS `object-fit: cover` (crops the overflow, centred) */
export function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, zoom = 1, offsetX = 0, offsetY = 0) {
  const { width: w, height: h } = ctx.canvas
  const s = Math.max(w / img.width, h / img.height) * zoom
  const dw = img.width * s, dh = img.height * s
  ctx.drawImage(img, (w - dw) / 2 + offsetX, (h - dh) / 2 + offsetY, dw, dh)
}
