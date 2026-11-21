// Sukuna face: your face goes black and FOUR glowing red eyes appear on it.
//
// Eyes are tracked from face landmarks (MediaPipe face mesh indices):
//   eye A: inner 133, outer 33,  top 159, bottom 145
//   eye B: inner 362, outer 263, top 386, bottom 374
//   face "up" direction: chin (152) -> forehead (10)
//
// Each eye is a BLADE shape (same generator as the Shrine slashes: tapered crescent).
//   upper eye: big, sweeps from your inner eye corner UP and OUT toward the temple
//   lower eye: smaller, sits under your real eye, pointing outward
//   + small tick marks, like the reference art.
//
// The blade shapes are generated ONCE per cast in a "unit" space (from (0,0) to (1,0)), then
// each frame we move/rotate/scale that same shape onto your eyes. Generating a new random
// shape every frame would make the eyes flicker.

import { FACE_OVAL, type Face } from './faceTracker'
import { makeBlade, bladePath, type Blade } from './blade'

type V = { x: number; y: number }
const add = (a: V, b: V, k = 1): V => ({ x: a.x + b.x * k, y: a.y + b.y * k })
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y })
const len = (a: V) => Math.hypot(a.x, a.y)
const norm = (a: V): V => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l } }

const USED = [10, 152, 133, 33, 159, 145, 362, 263, 386, 374]

export class SukunaFace {
  private shadow = document.createElement('canvas')
  private smooth = new Map<number, V>() // smoothed landmark positions (steadier eyes)
  private shapes: { upper: Blade; lower: Blade } | null = null

  reset() {
    this.smooth.clear()
    // unit-space shapes: thin crescents, belly on one side
    this.shapes = {
      upper: makeBlade(0, 0, 1, 0, 0.13, 0),
      lower: makeBlade(0, 0, 1, 0, 0.12, 0),
    }
  }

  draw(ctx: CanvasRenderingContext2D, face: Face | null, amt: number) {
    if (!face || amt <= 0) return
    if (!this.shapes) this.reset()
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

      this.drawEye(ctx, this.shapes!.upper, a1, b1, down)
      this.drawEye(ctx, this.shapes!.lower, a2, b2, down)

      // tick marks
      ctx.strokeStyle = '#ff2a00'
      ctx.lineWidth = Math.max(1.5, eyeW * 0.06)
      ctx.lineCap = 'round'
      ctx.shadowColor = '#ff2a00'
      ctx.shadowBlur = 8
      const t1a = add(add(a1, up, eyeW * 0.3), out, eyeW * 0.25), t1b = add(add(a1, up, eyeW * 0.55), out, eyeW * 0.4)
      const t2a = add(add(b2, up, eyeH * 0.9), out, -eyeW * 0.25), t2b = add(add(b2, up, eyeH * 1.4), out, -eyeW * 0.05)
      ctx.beginPath()
      ctx.moveTo(t1a.x, t1a.y); ctx.lineTo(t1b.x, t1b.y)
      ctx.moveTo(t2a.x, t2a.y); ctx.lineTo(t2b.x, t2b.y)
      ctx.stroke()
      ctx.shadowBlur = 0
    }
    ctx.restore()
  }

  /** place a unit-space blade from a to b, with its fat side facing `belly` */
  private drawEye(ctx: CanvasRenderingContext2D, shape: Blade, a: V, b: V, belly: V) {
    const d = sub(b, a), L = len(d)
    const ang = Math.atan2(d.y, d.x)
    // after rotating, local +y points to (-sin, cos). Flip if that's not toward the belly side.
    const flip = -Math.sin(ang) * belly.x + Math.cos(ang) * belly.y < 0 ? -1 : 1
    ctx.save()
    ctx.translate(a.x, a.y)
    ctx.rotate(ang)
    ctx.scale(L, L * flip)
    ctx.beginPath()
    bladePath(ctx, shape)
    ctx.restore() // restore BEFORE filling so the glow isn't stretched by the scale
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
