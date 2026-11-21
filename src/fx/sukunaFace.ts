// Sukuna face: your face goes black and FOUR glowing red eyes appear on it.
//
// Eyes are tracked from face landmarks (MediaPipe face mesh indices):
//   eye A: inner 133, outer 33,  top 159, bottom 145
//   eye B: inner 362, outer 263, top 386, bottom 374
//   face "up" direction: chin (152) -> forehead (10)
//
// Each eye is a red DIAMOND stretched long: 4 points — two sharp tips at the ends of a long
// axis, and two side corners that set its thickness. Putting the side corners closer to the
// INNER tip (not in the middle) makes it look like an eye narrowing toward the temple.
//   upper eye: big, sweeps from your inner eye corner UP and OUT toward the temple
//   lower eye: smaller, sits under your real eye, pointing outward

import { FACE_OVAL, type Face } from './faceTracker'

type V = { x: number; y: number }
const add = (a: V, b: V, k = 1): V => ({ x: a.x + b.x * k, y: a.y + b.y * k })
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y })
const len = (a: V) => Math.hypot(a.x, a.y)
const norm = (a: V): V => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l } }

const USED = [10, 152, 133, 33, 159, 145, 362, 263, 386, 374]

export class SukunaFace {
  private shadow = document.createElement('canvas')
  private smooth = new Map<number, V>() // smoothed landmark positions (steadier eyes)

  reset() {
    this.smooth.clear()
  }

  draw(ctx: CanvasRenderingContext2D, face: Face | null, amt: number) {
    if (!face || amt <= 0) return
    const { width: w, height: h } = ctx.canvas

    // smooth only the landmarks we use (lerp toward the new position each frame)
    for (const i of USED) {
      const p = { x: face[i].x * w, y: face[i].y * h }
      const s = this.smooth.get(i)
      this.smooth.set(i, s ? { x: s.x + (p.x - s.x) * 0.6, y: s.y + (p.y - s.y) * 0.6 } : p)
    }
    const P = (i: number) => this.smooth.get(i)!
    const up = norm(sub(P(10), P(152)))
    const down = { x: -up.x, y: -up.y }

    this.drawShadow(ctx, face, w, h, amt)

    ctx.save()
    ctx.globalAlpha = amt
    for (const [inner, outer, top, bottom] of [[133, 33, 159, 145], [362, 263, 386, 374]]) {
      const I = P(inner), O = P(outer)
      const eyeW = len(sub(O, I))
      const eyeH = Math.max(len(sub(P(top), P(bottom))), eyeW * 0.25)
      const out = norm(sub(O, I))

      // upper eye: inner corner -> up & out past the eyebrow
      const a1 = add(I, up, eyeH * 0.3)
      const b1 = add(add(O, out, eyeW * 0.85), up, eyeW * 1.3)
      // lower eye: under the real eye -> outward
      const a2 = add(add(I, down, eyeH * 1.3), out, eyeW * 0.05)
      const b2 = add(add(O, out, eyeW * 0.45), down, eyeH * 0.55)

      this.drawEye(ctx, a1, b1, 0.11, 0.38) // long, slim upper diamond
      this.drawEye(ctx, a2, b2, 0.12, 0.42) // shorter lower diamond
    }
    ctx.restore()
  }

  /**
   * A stretched diamond from tip a to tip b.
   * @param thick  half-thickness as a fraction of its length (0.2 = long and slim)
   * @param widest where along a->b the side corners sit (0.5 = symmetric, smaller = fat near a)
   */
  private drawEye(ctx: CanvasRenderingContext2D, a: V, b: V, thick: number, widest: number) {
    const d = sub(b, a), L = len(d)
    const n = { x: -d.y / L, y: d.x / L }              // sideways, perpendicular to the long axis
    const mid = add(a, d, widest)                       // where the diamond is widest
    const s1 = add(mid, n, L * thick), s2 = add(mid, n, -L * thick)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(s1.x, s1.y)
    ctx.lineTo(b.x, b.y)
    ctx.lineTo(s2.x, s2.y)
    ctx.closePath()
    ctx.lineJoin = 'miter'
    ctx.shadowColor = '#ff2a00'
    ctx.shadowBlur = 16 // only 4 eyes: shadowBlur is affordable here
    ctx.fillStyle = '#ff2200'
    ctx.fill()
    ctx.shadowBlur = 0
  }

  /** black face with a soft edge: drawn small + blurred, then stretched (cheap feathering) */
  private drawShadow(ctx: CanvasRenderingContext2D, face: Face, w: number, h: number, amt: number) {
    const sw = w >> 2, sh = h >> 2
    if (this.shadow.width !== sw) { this.shadow.width = sw; this.shadow.height = sh }
    const g = this.shadow.getContext('2d')!
    g.clearRect(0, 0, sw, sh)
    g.filter = 'blur(2px)'
    g.fillStyle = '#000'
    g.beginPath()
    // grow the oval 6% outward from its centre so the edge of the face is fully covered
    let cx = 0, cy = 0
    for (const i of FACE_OVAL) { cx += face[i].x; cy += face[i].y }
    cx /= FACE_OVAL.length; cy /= FACE_OVAL.length
    FACE_OVAL.forEach((i, k) => {
      const x = (cx + (face[i].x - cx) * 1.06) * sw, y = (cy + (face[i].y - cy) * 1.06) * sh
      if (k === 0) g.moveTo(x, y); else g.lineTo(x, y)
    })
    g.closePath()
    g.fill()
    g.filter = 'none'
    ctx.save()
    ctx.globalAlpha = amt * 0.96
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(this.shadow, 0, 0, w, h)
    ctx.restore()
  }
}
