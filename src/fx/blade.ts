// Blade shapes for slashes — PROCEDURAL GEOMETRY.
//
// Instead of drawing a line, we build a closed outline, the way you'd sketch a blade:
//   1. a SPINE: a gently curved centre line (quadratic Bézier curve: start, bend point, end)
//   2. a WIDTH PROFILE: how thick the blade is at each point along the spine.
//      0 at both tips -> sharp points. Widest a bit past the middle. One side fatter than
//      the other, so it looks like a crescent sliver, not a symmetric leaf.
//   3. walk along the spine, step out sideways by the width on each side -> two edges.
//      Top edge forward + bottom edge backward = one closed outline.
//   4. NOTCHES: at a few random spots the top edge suddenly jumps inward, then eases
//      back out. That's the jagged "tooth" in your reference sketches.
//   5. SHARDS: a couple of tiny blades of the same kind, floating beside the big one.
//
// "Procedural" = made by rules + randomness, so every blade is different but recognisably
// the same family. Games use this for trees, rocks, lightning, whole planets.

export type Pt = { x: number; y: number; t: number } // t = 0..1, position along the spine
export type Blade = { top: Pt[]; bottom: Pt[] }

import { rand } from '../util/math'

/** thickness at t (0..1): 0 at the tips, peak at `peak`, curved like a crescent */
function profile(t: number, peak: number) {
  const s = t < peak ? t / peak : (1 - t) / (1 - peak)
  return Math.pow(Math.sin((s * Math.PI) / 2), 0.8)
}

export function makeBlade(
  x0: number, y0: number, x1: number, y1: number,
  maxWidth: number, notchCount: number,
): Blade {
  const dx = x1 - x0, dy = y1 - y0
  const len = Math.hypot(dx, dy)
  const nx = -dy / len, ny = dx / len // unit vector sideways from the spine

  // bend point: the middle, pushed sideways a bit -> gentle curve
  const bend = rand(-0.12, 0.12) * len
  const cx = (x0 + x1) / 2 + nx * bend, cy = (y0 + y1) / 2 + ny * bend

  const peak = rand(0.45, 0.7)
  const topScale = 1, botScale = rand(0.35, 0.7) // lopsided -> crescent

  // notches: where (t), how deep (fraction of local width), how long the tooth is
  const notches = Array.from({ length: notchCount }, () => ({
    t: rand(0.2, 0.8), depth: rand(0.5, 1.1), span: rand(0.04, 0.09),
  })).sort((a, b) => a.t - b.t)

  // sample positions along the spine; each notch gets TWO samples at the same t
  // (before + after the jump) so the edge makes a sharp corner instead of a smooth dip
  const N = 40
  const samples: { t: number; afterNotch: number }[] = []
  for (let i = 0; i <= N; i++) samples.push({ t: i / N, afterNotch: -1 })
  notches.forEach((n, k) => samples.push({ t: n.t, afterNotch: -1 }, { t: n.t, afterNotch: k }))
  samples.sort((a, b) => a.t - b.t || a.afterNotch - b.afterNotch)

  const top: Pt[] = [], bottom: Pt[] = []
  for (const s of samples) {
    const t = s.t, u = 1 - t
    // point on the curved spine + its direction (Bézier formula and its derivative)
    const px = u * u * x0 + 2 * u * t * cx + t * t * x1
    const py = u * u * y0 + 2 * u * t * cy + t * t * y1
    let tx = 2 * u * (cx - x0) + 2 * t * (x1 - cx)
    let ty = 2 * u * (cy - y0) + 2 * t * (y1 - cy)
    const tl = Math.hypot(tx, ty) || 1
    tx /= tl; ty /= tl
    const sx = -ty, sy = tx // sideways at this point of the curve

    const w = maxWidth * profile(t, peak)
    // how far a notch pushes the top edge inward here
    let inward = 0
    notches.forEach((n, k) => {
      if (t > n.t && t < n.t + n.span) inward = Math.max(inward, n.depth * (1 - (t - n.t) / n.span))
      if (s.afterNotch === k) inward = Math.max(inward, n.depth)
    })
    const wt = w * topScale * (1 - inward)
    const wb = w * botScale
    top.push({ x: px + sx * wt, y: py + sy * wt, t })
    bottom.push({ x: px - sx * wb, y: py - sy * wb, t })
  }
  return { top, bottom }
}

/** Add the blade's outline to the current path, revealed from its start up to `upTo` (0..1). */
export function bladePath(ctx: CanvasRenderingContext2D, b: Blade, upTo = 1) {
  const top = b.top.filter((p) => p.t <= upTo)
  const bot = b.bottom.filter((p) => p.t <= upTo)
  if (top.length < 2) return
  ctx.moveTo(top[0].x, top[0].y)
  for (let i = 1; i < top.length; i++) ctx.lineTo(top[i].x, top[i].y)
  for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i].x, bot[i].y)
  ctx.closePath()
}
