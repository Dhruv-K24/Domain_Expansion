// BodyLayer — draws YOU, cut out of the room, so a domain can replace the background.
// Shared by every domain (it used to live inside malevolentShrine.ts; when a second domain
// needed the same thing, it moved here instead of being copy-pasted — copies drift apart
// and you end up fixing the same bug twice).
//
//   1. glow rim: a blurred copy of your silhouette in `rim` colour, drawn behind you = halo
//   2. you: the webcam image, colours muted + darkened, cut to your silhouette
//   3. edge fade: your outline darkens into the background, so you sit INSIDE the scene

export class BodyLayer {
  private glow = document.createElement('canvas')
  private body = document.createElement('canvas')
  private edge = document.createElement('canvas')

  /** @param tint optional colour your body gets washed in (e.g. dark blue for Chimera) */
  draw(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, mask: HTMLCanvasElement, w: number, h: number, amt: number, rim = '#fff', tint?: string) {
    // PERFORMANCE: blur is expensive and its cost grows with pixel count. The glow and the
    // edge fade are blurry by nature, so we make them at 1/4 size (160x120 = 16x fewer pixels)
    // and let the browser stretch them up smoothly. Same look, a fraction of the cost.
    const sw = w >> 2, sh = h >> 2
    for (const c of [this.glow, this.edge]) if (c.width !== sw) { c.width = sw; c.height = sh }
    if (this.body.width !== w) { this.body.width = w; this.body.height = h }
    const g = this.glow.getContext('2d')!, b = this.body.getContext('2d')!, e = this.edge.getContext('2d')!
    ctx.imageSmoothingEnabled = true

    // GLOW RIM: blurred mask recoloured white, drawn behind the body -> halo
    g.globalCompositeOperation = 'source-over'
    g.clearRect(0, 0, sw, sh)
    g.filter = 'blur(2px)'          // 2px at 1/4 size ~= 8px at full size
    g.drawImage(mask, 0, 0, sw, sh)
    g.filter = 'none'
    g.globalCompositeOperation = 'source-in'
    g.fillStyle = rim
    g.fillRect(0, 0, sw, sh)
    ctx.globalAlpha = amt * (0.75 + Math.random() * 0.25)
    ctx.drawImage(this.glow, 0, 0, w, h)
    ctx.drawImage(this.glow, 0, 0, w, h)

    // BODY: your webcam image, cut to your shape. Colour tweaks use BLEND MODES instead of
    // ctx.filter (blend modes run on the GPU; filters on video frames are slower).
    b.globalCompositeOperation = 'source-over'
    b.clearRect(0, 0, w, h)
    b.drawImage(video, 0, 0, w, h)
    b.globalCompositeOperation = 'saturation' // take the saturation of grey -> mutes colours
    b.globalAlpha = 0.45
    b.fillStyle = '#808080'
    b.fillRect(0, 0, w, h)
    b.globalCompositeOperation = 'source-over' // then a see-through black layer -> darker
    b.globalAlpha = 0.4
    b.fillStyle = '#000'
    b.fillRect(0, 0, w, h)
    if (tint) {
      // 'color' blend = keep the light/dark of the image, take the HUE of the tint
      b.globalCompositeOperation = 'color'
      b.globalAlpha = 0.5 // how strongly the tint replaces your colours
      b.fillStyle = tint
      b.fillRect(0, 0, w, h)
      b.globalCompositeOperation = 'source-over'
    }
    b.globalAlpha = 1
    b.globalCompositeOperation = 'destination-in'
    b.drawImage(mask, 0, 0, w, h)

    // black gradient on the body's edges so you melt into the void (also at 1/4 size)
    e.globalCompositeOperation = 'source-over'
    e.fillStyle = '#000'
    e.fillRect(0, 0, sw, sh)
    e.globalCompositeOperation = 'destination-out'
    e.filter = 'blur(6px)'          // ~24px at full size
    e.drawImage(mask, 0, 0, sw, sh)
    e.filter = 'none'
    b.globalCompositeOperation = 'source-atop'
    b.drawImage(this.edge, 0, 0, w, h)
    b.drawImage(this.edge, 0, 0, w, h)
    b.globalCompositeOperation = 'source-over'

    ctx.globalAlpha = amt
    ctx.drawImage(this.body, 0, 0)
    ctx.globalAlpha = 1
  }
}
