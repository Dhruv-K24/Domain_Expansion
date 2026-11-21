// HeatHaze — wobbly hot air, done the old-school way.
//
// Real distortion (moving each pixel) is too slow in Canvas 2D on a potato. The classic trick:
// copy the finished frame, then redraw it as thin horizontal STRIPS, each shifted sideways by a
// wave that moves over time. Your eye reads the rippling strips as shimmering hot air.
// Stronger near the bottom (heat rises from the lava), calmer at the top.

export class HeatHaze {
  private copy = document.createElement('canvas')

  /**
   * Apply to everything already drawn on ctx.
   * @param strength 0..1
   */
  apply(ctx: CanvasRenderingContext2D, time: number, strength: number) {
    if (strength <= 0.01) return
    const { width: w, height: h } = ctx.canvas
    if (this.copy.width !== w) { this.copy.width = w; this.copy.height = h }
    const c = this.copy.getContext('2d')!
    c.clearRect(0, 0, w, h)
    c.drawImage(ctx.canvas, 0, 0)

    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, w, h)
    const strip = 6
    for (let y = 0; y < h; y += strip) {
      const heat = 0.25 + 0.75 * (y / h) // more wobble near the bottom
      // two waves of different speed/size -> irregular shimmer, not a neat sine
      const dx = (Math.sin(y * 0.045 + time * 7) * 2.2 + Math.sin(y * 0.11 - time * 11) * 1.2) * heat * strength
      ctx.drawImage(this.copy, 0, y, w, strip, dx, y, w, strip)
    }
    ctx.restore()
  }
}
