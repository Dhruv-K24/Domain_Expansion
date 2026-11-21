// Gojo's eyes: two big glowing anime eyes drawn over YOUR eyes (your body is a black silhouette).
//
// Tracked from face landmarks:
//   eye A: corners 33 / 133, lids 159 / 145      eye B: corners 263 / 362, lids 386 / 374
//   iris centres: 468 and 473 (the face model also finds your irises!)
// so the drawn iris FOLLOWS WHERE YOU LOOK.
//
// Each eye is drawn in "eye space": origin at the eye centre, x along the line between the
// corners, y = the face's up direction. So it tilts and scales with your head.
//
// Layers (back to front): iris (clipped to the eye shape) -> pupil -> highlights ->
// white outline -> lashes. Anime eyes are mostly outline + one bold colour + sparkles.

import type { Face } from './faceTracker'

type V = { x: number; y: number }
const USED = [10, 152, 33, 133, 159, 145, 263, 362, 386, 374, 468, 473]
const TILT = 0.17 // ~10 degrees: outer corners raised (the sharp anime look)

export class GojoEyes {
  private smooth = new Map<number, V>()

  reset() {
    this.smooth.clear()
  }

  draw(ctx: CanvasRenderingContext2D, face: Face | null, amt: number, time: number) {
    if (!face || amt <= 0 || face.length < 474) return
    const { width: w, height: h } = ctx.canvas
    for (const i of USED) {
      const p = { x: face[i].x * w, y: face[i].y * h }
      const s = this.smooth.get(i)
      this.smooth.set(i, s ? { x: s.x + (p.x - s.x) * 0.6, y: s.y + (p.y - s.y) * 0.6 } : p)
    }
    const P = (i: number) => this.smooth.get(i)!
    const upAng = Math.atan2(P(10).y - P(152).y, P(10).x - P(152).x)

    const eyes = [[33, 133, 159, 145], [263, 362, 386, 374]]
    const centre = (o: number, i: number) => ({ x: (P(o).x + P(i).x) / 2, y: (P(o).y + P(i).y) / 2 })
    const cA = centre(33, 133), cB = centre(263, 362)
    // HUMAN PROPORTIONS: the gap between the eyes is about ONE eye-width. So each eye spans
    // ~55% of the centre-to-centre distance and ~45% is left as the gap between them.
    // Sizing from that distance keeps the spacing right even if the corner points wobble.
    const D = Math.hypot(cA.x - cB.x, cA.y - cB.y)
    const halfW = D * 0.28
    for (const [outer, inner, top, bottom] of eyes) {
      const O = P(outer), I = P(inner)
      const c = centre(outer, inner)
      // the iris landmark closest to this eye belongs to it
      const ir = [P(468), P(473)].sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0]
      const eyeW = Math.hypot(O.x - I.x, O.y - I.y)
      const open = Math.hypot(P(top).x - P(bottom).x, P(top).y - P(bottom).y) / eyeW // ~0.3 open, ~0.05 blink
      this.drawEye(ctx, c, ir, O, I, halfW, Math.max(0.12, Math.min(1, open / 0.3)), upAng, amt, time)
    }
  }

  /** @param W half-width of the drawn eye (from face proportions, see above) */
  private drawEye(ctx: CanvasRenderingContext2D, c: V, iris: V, O: V, I: V, W: number, open: number, upAng: number, amt: number, time: number) {
    const H = W * 0.55 * open        // how tall the eye opening is (closes when you blink)
    // LOCAL AXES: x points from your inner eye corner to the outer one (so the outer corner is
    // always +x, for both eyes). After rotating by that angle, the canvas's local +y points
    // along (-sin, cos). We want local +y to mean "up the face" — the two eyes face opposite
    // ways, so for one of them we must flip y, or it would be drawn upside down.
    const ax = Math.atan2(O.y - I.y, O.x - I.x)
    const ly0 = { x: -Math.sin(ax), y: Math.cos(ax) }
    const ySign = ly0.x * Math.cos(upAng) + ly0.y * Math.sin(upAng) > 0 ? 1 : -1

    ctx.save()
    ctx.translate(c.x, c.y)
    ctx.rotate(ax)
    ctx.scale(1, ySign)
    // TILT: anime eyes slant UP toward the outer corner (+x is outer, +y is up -> positive turn)
    ctx.rotate(TILT)

    // iris position in local (tilted) coordinates: follows your real iris, kept inside the eye
    const dx = iris.x - c.x, dy = iris.y - c.y
    const ex = dx * Math.cos(ax) + dy * Math.sin(ax)
    const ey = (dx * ly0.x + dy * ly0.y) * ySign
    const lx = ex * Math.cos(TILT) + ey * Math.sin(TILT)  // undo the tilt for the iris position
    const ly = -ex * Math.sin(TILT) + ey * Math.cos(TILT)
    const R = W * 0.52                      // iris radius
    const ix = Math.max(-W * 0.35, Math.min(W * 0.35, lx * 1.4))
    const iy = Math.max(-H * 0.4, Math.min(H * 0.4, ly * 1.4)) + H * 0.05

    // eye shape: upper lid arches high, lower lid flatter; outer corner slightly raised
    const eyePath = () => {
      ctx.beginPath()
      ctx.moveTo(-W, -H * 0.05)
      ctx.bezierCurveTo(-W * 0.55, H * 1.25, W * 0.45, H * 1.3, W, H * 0.12)
      ctx.bezierCurveTo(W * 0.55, -H * 0.85, -W * 0.5, -H * 0.85, -W, -H * 0.05)
      ctx.closePath()
    }

    ctx.globalAlpha = amt

    // 1. IRIS, clipped to the eye shape (lids cut over the top of the iris = anime look)
    ctx.save()
    eyePath()
    ctx.clip()
    const g = ctx.createRadialGradient(ix - R * 0.2, iy + R * 0.25, R * 0.05, ix, iy, R)
    g.addColorStop(0, '#c9f6ff')
    g.addColorStop(0.35, '#4fd2ff')
    g.addColorStop(0.75, '#119dff')
    g.addColorStop(1, '#0557c9')
    ctx.shadowColor = '#3fd0ff'
    ctx.shadowBlur = 18 // glowing iris (only 2 eyes: affordable)
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(ix, iy, R, 0, Math.PI * 2); ctx.fill()
    ctx.shadowBlur = 0
    // iris texture: faint lighter streaks radiating from the pupil, slowly turning (alive)
    ctx.strokeStyle = 'rgba(210,250,255,0.35)'
    ctx.lineWidth = Math.max(0.8, W * 0.02)
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + time * 0.15
      ctx.beginPath()
      ctx.moveTo(ix + Math.cos(a) * R * 0.32, iy + Math.sin(a) * R * 0.32)
      ctx.lineTo(ix + Math.cos(a) * R * 0.85, iy + Math.sin(a) * R * 0.85)
      ctx.stroke()
    }
    // pupil: small, deep blue
    ctx.fillStyle = '#063f86'
    ctx.beginPath(); ctx.arc(ix, iy, R * 0.26, 0, Math.PI * 2); ctx.fill()
    // highlights: one big sparkle top-left, a small one bottom-right, a dashed arc of glints
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.beginPath(); ctx.ellipse(ix - R * 0.38, iy + R * 0.36, R * 0.17, R * 0.12, 0.5, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(ix + R * 0.3, iy - R * 0.32, R * 0.07, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'
    ctx.lineWidth = Math.max(1, W * 0.035)
    ctx.lineCap = 'round'
    for (let k = 0; k < 4; k++) {
      const a = Math.PI * (1.05 + k * 0.12)
      ctx.beginPath()
      ctx.arc(ix, iy, R * 0.72, a, a + 0.07)
      ctx.stroke()
    }
    ctx.restore()

    // 2. WHITE OUTLINE (thicker upper lid, like anime line art) with a soft glow
    ctx.shadowColor = '#bfe9ff'
    ctx.shadowBlur = 10
    ctx.strokeStyle = '#ffffff'
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.lineWidth = Math.max(1.5, W * 0.05)
    eyePath()
    ctx.stroke()
    ctx.lineWidth = Math.max(2, W * 0.09) // heavier upper lid line
    ctx.beginPath()
    ctx.moveTo(-W * 1.02, -H * 0.02)
    ctx.bezierCurveTo(-W * 0.55, H * 1.27, W * 0.45, H * 1.32, W * 1.04, H * 0.14)
    ctx.stroke()

    // 3. LASHES: short white strokes fanning up and out along the outer half of the upper lid
    ctx.lineWidth = Math.max(1.2, W * 0.035)
    for (let k = 0; k < 6; k++) {
      const u = 0.15 + k * 0.15                 // position along the outer part of the lid
      const bx = -W + 2 * W * (0.5 + u * 0.5)   // from the middle of the lid toward the outer corner
      const t = (bx + W) / (2 * W)
      const by = H * (1.25 * 4 * t * (1 - t)) * 0.95
      const len = W * (0.16 + 0.08 * (k % 2))
      const ang = Math.PI / 2 - 0.35 - k * 0.16 // tilt further outward toward the corner
      ctx.beginPath()
      ctx.moveTo(bx, by)
      ctx.lineTo(bx + Math.cos(ang) * len, by + Math.sin(ang) * len)
      ctx.stroke()
    }
    ctx.shadowBlur = 0
    ctx.restore()
  }
}
