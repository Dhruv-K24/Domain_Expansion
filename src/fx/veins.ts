// Veins — branching organic lines (roots, veins, lightning, cracks), grown by a RANDOM WALK.
//
// GROWING: start at an origin, take small steps. The turning rate drifts gradually
// (momentum) so veins curve smoothly like roots instead of zig-zagging like lightning.
// Each ROOT vein steers toward its own TARGET zone on screen, so together they cover the
// whole screen evenly (see `spreadTargets`). Now and then a thinner BRANCH splits off.
//
// Every point remembers:
//   d       how far it is from the origin ALONG the vein -> "light up from origin outward"
//           and "fade from the tips inward" are just "draw points with d < reach"
//   nx, ny  the sideways direction at that point -> used to bend the vein for the whip
//
// MOVING (the whip): each point is pushed sideways by a TRAVELLING WAVE:
//     offset = amp * sin(d * k  -  phase)
// As `phase` grows, the crests move toward bigger d = the wave runs from the origin to the
// tip, exactly like cracking a whip or flicking a rope. Big amp + fast phase = violent lash;
// small amp + slow phase = lazy underwater sway. Same formula, different numbers.

export type VeinPoint = { x: number; y: number; d: number; nx: number; ny: number }
export type Vein = { pts: VeinPoint[]; depth: number; seed: number; group: number }
export type VeinOrigin = { x: number; y: number; angle: number; target?: { x: number; y: number } }

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a)) // angle into -PI..PI

/**
 * Even coverage: split the screen into a cols x rows grid and put one random point in each
 * cell ("stratified sampling" — random, but no empty areas and no clumps).
 * Returned SHUFFLED, so neighbouring veins end up in different groups.
 */
export function spreadTargets(w: number, h: number, cols: number, rows: number) {
  const pts = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      pts.push({ x: ((c + rand(0.15, 0.85)) / cols) * w, y: ((r + rand(0.15, 0.85)) / rows) * h })
  for (let i = pts.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pts[i], pts[j]] = [pts[j], pts[i]] }
  return pts
}

/**
 * @param groups veins are split into this many GROUPS (a root and all its branches share one),
 *   so each group can get its own speed/timing.
 * @param branching chance per step that a branch splits off (0 = every vein runs straight
 *   from its origin, none hang off other veins)
 */
export function growVeins(origins: VeinOrigin[], w: number, h: number, centre: { x: number; y: number }, groups = 1, branching = 0.045): Vein[] {
  const veins: Vein[] = []
  const margin = 60
  const step = 8

  const grow = (x: number, y: number, angle: number, d: number, depth: number, group: number, target?: { x: number; y: number }) => {
    const pts: VeinPoint[] = [{ x, y, d, nx: -Math.sin(angle), ny: Math.cos(angle) }]
    let a = angle
    let turn = 0 // momentum: the turning rate changes gradually -> smooth curves
    let tgt = target
    for (let i = 0; i < 240; i++) {
      // steer: toward the target zone until we reach it, then outward from the centre
      if (tgt && Math.hypot(tgt.x - x, tgt.y - y) < 50) tgt = undefined
      const want = tgt ? Math.atan2(tgt.y - y, tgt.x - x) : Math.atan2(y - centre.y, x - centre.x)
      turn = turn * 0.82 + rand(-0.07, 0.07)
      a += turn + wrap(want - a) * (tgt ? 0.06 : 0.03)
      x += Math.cos(a) * step
      y += Math.sin(a) * step
      d += step
      pts.push({ x, y, d, nx: -Math.sin(a), ny: Math.cos(a) })
      if (x < -margin || x > w + margin || y < -margin || y > h + margin) break
      if (branching > 0 && depth < 3 && i > 4 && Math.random() < branching - depth * 0.01) {
        grow(x, y, a + (Math.random() < 0.5 ? -1 : 1) * rand(0.35, 0.9), d, depth + 1, group)
      }
    }
    veins.push({ pts, depth, seed: Math.random() * 100, group })
  }

  origins.forEach((o, i) => grow(o.x, o.y, o.angle, 0, 0, i % groups, o.target))
  return veins
}

/**
 * Draw veins with a glow: only the parts with d < reach, bent by the travelling wave.
 * Veins are grouped by depth and each depth is ONE path per pass (batching = speed).
 * @param phase wave position (keeps growing; how FAST it grows = how fast the wave travels)
 * @param amp   how far (px) the wave bends the vein sideways
 */
export function drawVeins(
  ctx: CanvasRenderingContext2D, veins: Vein[], reach: number, phase: number, amp: number,
  colours: { glow: string; mid: string; core: string }, alpha: number, group?: number,
) {
  if (reach <= 0 || alpha <= 0) return
  const widths = [3.2, 2.2, 1.4, 0.9]
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (let depth = 0; depth < 4; depth++) {
    const path = new Path2D()
    for (const v of veins) {
      if (v.depth !== depth || (group !== undefined && v.group !== group)) continue
      let started = false
      for (const p of v.pts) {
        if (p.d > reach) break
        // pinned at the origin (k=0), free at the far end -> it bends like a rope held at one end
        const k = Math.min(1, p.d / 260)
        // two waves of different lengths travelling outward = a lively, uneven lash
        const wave =
          Math.sin(p.d * 0.022 - phase * 6 + v.seed) * 0.7 +
          Math.sin(p.d * 0.009 - phase * 3.1 + v.seed * 1.7) * 0.3
        const off = wave * amp * k
        const x = p.x + p.nx * off, y = p.y + p.ny * off
        if (!started) { path.moveTo(x, y); started = true } else path.lineTo(x, y)
      }
    }
    const lw = widths[depth]
    ctx.globalAlpha = alpha * 0.2 // wide soft halo = the "glow"
    ctx.strokeStyle = colours.glow
    ctx.lineWidth = lw * 7
    ctx.stroke(path)
    ctx.globalAlpha = alpha * 0.55
    ctx.strokeStyle = colours.mid
    ctx.lineWidth = lw * 2
    ctx.stroke(path)
    ctx.globalAlpha = alpha * 0.9
    ctx.strokeStyle = colours.core
    ctx.lineWidth = lw * 0.7
    ctx.stroke(path)
  }
  ctx.restore()
}
