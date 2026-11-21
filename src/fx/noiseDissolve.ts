// NoiseDissolve — organic "eat away / fill in" transitions.
//
// Every cell of a low-res grid gets a value: "when do I flip?". A threshold sweeps through
// those values over time; cells past it flip. Because neighbouring values are similar
// (blurred noise), whole blobs flip together -> ink, smoke, burning paper looks.
//
// Used by: Malevolent Shrine (room dissolves into black, red burning edge)
//          Unlimited Void   (white burst gets eaten away, splatter left at the edges)

export type DissolveOptions = {
  width: number
  height: number
  layers: { radius: number; weight: number }[] // blurred noise layers: big blobs + small detail
  centreBias: number                            // >0: centre flips first. <0: edges flip first
  /** optional extra direction, u/v = 0..1 across/down the screen. Return LOW = flips early.
   *  e.g. (u, v) => (1 - v) * 1.5  -> bottom flips first, like shadow rising from the floor */
  bias?: (u: number, v: number) => number
}

export class NoiseDissolve {
  private canvas = document.createElement('canvas')
  private ctx: CanvasRenderingContext2D
  private img: ImageData
  private noise: Float32Array
  private opts: DissolveOptions

  constructor(opts: DissolveOptions) {
    this.opts = opts
    this.canvas.width = opts.width
    this.canvas.height = opts.height
    this.ctx = this.canvas.getContext('2d')!
    this.img = this.ctx.createImageData(opts.width, opts.height)
    this.noise = new Float32Array(opts.width * opts.height)
    this.reseed()
  }

  /** new random pattern (call at each cast so it's different every time) */
  reseed() {
    const { width: W, height: H, layers, centreBias, bias } = this.opts
    this.noise.fill(0)
    for (const { radius, weight } of layers) {
      const blurred = blurredNoise(W, H, radius)
      for (let i = 0; i < blurred.length; i++) this.noise[i] += (blurred[i] - 0.5) * weight
    }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        this.noise[y * W + x] +=
          Math.hypot(x / W - 0.5, (y / H - 0.5) * 0.8) * centreBias + (bias ? bias(x / W, y / H) : 0)
  }

  /**
   * Draw the layer.
   * @param threshold sweeps over time; compare against noise values (roughly -1.5 .. 2.5)
   * @param mode 'below' = cells with noise BELOW threshold are solid (grows as threshold rises)
   *             'above' = cells ABOVE threshold are solid (shrinks as threshold rises)
   * @param sharpness bigger = crisper edges (ink); smaller = softer (smoke)
   * @param colour rgb of solid cells; edgeColour (optional) tints the soft edge (burning look)
   */
  draw(
    target: CanvasRenderingContext2D, threshold: number, mode: 'below' | 'above', sharpness: number,
    colour: [number, number, number], edgeColour?: [number, number, number],
  ) {
    const px = this.img.data, n = this.noise
    const sign = mode === 'below' ? 1 : -1
    for (let i = 0; i < n.length; i++) {
      const v = (threshold - n[i]) * sign * sharpness // >=1 solid, 0..1 edge, <=0 empty
      const j = i * 4
      if (v >= 1) { px[j] = colour[0]; px[j + 1] = colour[1]; px[j + 2] = colour[2]; px[j + 3] = 255 }
      else if (v > 0) {
        // the soft edge: either the same colour fading in, or a tinted glow (e.g. burning red)
        const c = edgeColour ? [edgeColour[0] * v, edgeColour[1] * v, edgeColour[2] * v] : colour
        px[j] = c[0]; px[j + 1] = c[1]; px[j + 2] = c[2]
        px[j + 3] = 255 * v
      } else px[j + 3] = 0
    }
    this.ctx.putImageData(this.img, 0, 0)
    const { width: w, height: h } = target.canvas
    target.imageSmoothingEnabled = true
    target.drawImage(this.canvas, -10, -10, w + 20, h + 20)
  }
}

/** random values, box-blurred (horizontal pass then vertical pass: much cheaper than 2D) */
function blurredNoise(W: number, H: number, r: number) {
  const raw = new Float32Array(W * H).map(() => Math.random())
  if (r <= 0) return raw
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let s = 0, n = 0
      for (let d = -r; d <= r; d++) { const xx = x + d; if (xx >= 0 && xx < W) { s += raw[y * W + xx]; n++ } }
      tmp[y * W + x] = s / n
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let s = 0, n = 0
      for (let d = -r; d <= r; d++) { const yy = y + d; if (yy >= 0 && yy < H) { s += tmp[yy * W + x]; n++ } }
      out[y * W + x] = s / n
    }
  return out
}
