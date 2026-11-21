// Chimera Shadow Garden — Megumi's domain.
//
// Timeline (9s):
//   0.0  SHADOW   liquid shadow rises from the floor and swallows the room
//   0.9  BONE     the bone totem slowly emerges from the dark, behind you, mostly hidden in shadow
//   2.9  PULSE    the veins flash for a moment, dim, then vanish (a heartbeat)
//   3.5  GLOW     light races out from the totem along the veins until they cover the screen
//   ...  ACTIVE   veins sway slightly; a faint red grid floor glows underneath
//   6.7  FADE     the glow drains from the tips back to the totem
//   8.1  END      the shadow dissolves away, back to the room
//
// Reuses: NoiseDissolve (shadow), BodyLayer with a blue tint (you), veins.ts (veins),
// DomainTitle with a black & white theme. Only the totem and the timeline are new here.

import { Domain, clamp01, easeOut, type DomainInputs } from './domain'
import { NoiseDissolve } from '../fx/noiseDissolve'
import { growVeins, drawVeins, spreadTargets, type Vein } from '../fx/veins'

const T = {
  shadowIn: 1300,
  boneStart: 900, boneEnd: 2800,
  pulseStart: 2900, pulseLen: 550,
  glowStart: 3500, glowLen: 1700,
  veinFadeStart: 6700, veinFadeLen: 1400,
  shadowOutStart: 8100,
  end: 9000,
}

const VEIN_COLOURS = { glow: '#1e9bff', mid: '#38c6ff', core: '#e2fbff' }
const PULSE_COLOURS = { glow: '#16407a', mid: '#2d6fb0', core: '#9cc0e8' } // dim, low-saturation flash

// 5 GROUPS of veins, each with its own personality, so the tree never moves as one block.
//   delay / glow: when this group starts lighting up and how long it takes to reach its tips
//   fade:         how long its glow takes to drain back
//   speed / amp:  how fast and how far it sways
const GROUPS = [
  { delay: 0,   glow: 1.0,  fade: 1.0, speed: 1.0,  amp: 1.0 },
  { delay: 150, glow: 0.75, fade: 0.8, speed: 1.4,  amp: 0.8 },
  { delay: 60,  glow: 1.3,  fade: 1.2, speed: 0.7,  amp: 1.3 },
  { delay: 280, glow: 0.9,  fade: 0.9, speed: 1.7,  amp: 0.7 },
  { delay: 120, glow: 1.55, fade: 1.4, speed: 0.55, amp: 1.6 },
]
// EASE-IN: k^2.1 -> at 30% of the time it's only ~8% of the way, then it races to the end
const easeIn = (k: number) => Math.pow(k, 2.1)

export class ChimeraShadowGarden extends Domain {
  private shadow = new NoiseDissolve({
    width: 200, height: 150,
    layers: [{ radius: 6, weight: 2 }, { radius: 2, weight: 0.6 }],
    centreBias: 0,
    bias: (_u, v) => (1 - v) * 1.8, // bottom flips first -> shadow rises from the floor
  })
  private totem = document.createElement('canvas')
  private veins: Vein[] = []
  private maxReach = 1
  private origin = { x: 320, y: 150 }
  private kickedPulse = false
  private kickedGlow = false
  private phases = GROUPS.map(() => Math.random() * 10) // each group's sway clock

  constructor() {
    super({
      id: 'chimera_shadow_garden',
      name: 'CHIMERA SHADOW GARDEN',
      theme: 'chimera',
      duration: T.end,
      fadeOut: 900,
      title: { showDE: 1500, showName: 2300, fade: 6900, end: T.end },
    })
  }

  protected onStart() {
    const { w, h } = this
    this.origin = { x: w * 0.5, y: h * 0.27 }
    this.shadow.reseed()
    this.bakeTotem()
    this.kickedPulse = this.kickedGlow = false

    // vein roots: 40 (divisible by the 5 groups). EVEN COVERAGE: the screen is split into an
    // 8x5 grid and each root steers toward its own cell, so no area is empty or crowded.
    // No branches: every vein connects straight to the totem.
    const o = this.origin
    const roots = spreadTargets(w, h, 8, 5).map((target) => {
      const angle = Math.atan2(target.y - o.y, target.x - o.x)
      return { x: o.x + Math.cos(angle) * h * 0.06, y: o.y + Math.sin(angle) * h * 0.05, angle, target }
    })
    this.veins = growVeins(roots, w, h, o, GROUPS.length, 0)
    this.maxReach = Math.max(...this.veins.flatMap((v) => v.pts.map((p) => p.d)))
  }

  protected draw(ctx: CanvasRenderingContext2D, { video, mask }: DomainInputs, t: number, dtMs: number) {
    const { w, h } = this
    const secs = t / 1000

    // ---- shake: tiny rumble, a thump at the pulse, a stronger one when the glow bursts out
    if (!this.kickedPulse && t > T.pulseStart) { this.kickedPulse = true; this.shake.kick(6) }
    if (!this.kickedGlow && t > T.glowStart) { this.kickedGlow = true; this.shake.kick(11) }
    this.shake.update(dtMs, t < T.shadowIn ? 1.2 : 0.4, 0.5, 0.88)

    // ---- 1. shadow: rises in, later dissolves out (threshold goes up, then back down)
    const inK = easeOut(clamp01(t / T.shadowIn))
    const outK = clamp01((t - T.shadowOutStart) / (T.end - T.shadowOutStart))
    const cover = inK * (1 - outK)
    if (cover > 0) this.shadow.draw(ctx, -1.6 + cover * 4.2, 'below', 7, [5, 6, 14], [20, 40, 90])

    // everything below sits INSIDE the shadow, so it shares its fade
    ctx.globalAlpha = 1 - outK

    // overall glow level (for the grid + origin light), using the slowest-lighting timing
    const glowK = easeIn(clamp01((t - T.glowStart) / T.glowLen))
    const fadeK = clamp01((t - T.veinFadeStart) / T.veinFadeLen)

    // ---- 2. faint red grid floor (as in the anime), only while the veins glow
    this.drawGrid(ctx, glowK * (1 - fadeK) * (1 - outK))

    // ---- 3. veins — drawn BEFORE the totem, so they sit behind it
    const pulseK = clamp01((t - T.pulseStart) / T.pulseLen)
    if (pulseK > 0 && pulseK < 1) {
      // the heartbeat: every vein flashes in dim colours for a moment, then vanishes
      drawVeins(ctx, this.veins, this.maxReach, this.phases[0], 2, PULSE_COLOURS, Math.sin(pulseK * Math.PI))
    }
    // WHIP: as each group lights up it LASHES: a big, fast wave racing from the totem to the tips,
    // decaying (exp = "starts big, dies off") into a slow, lazy sway. Each group whips on its own
    // timing, so the lashes ripple across the screen instead of all at once.
    GROUPS.forEach((g, i) => {
      const start = T.glowStart + g.delay
      const whip = t > start ? Math.exp(-(t - start) / 420) : 0 // short, sharp lash (~0.5s), then slow-mo
      // the wave's clock: ticks ~19x faster during the lash (accumulating = no jumps)
      this.phases[i] += (dtMs / 1000) * g.speed * (1 + 18 * whip)
      const gk = easeIn(clamp01((t - start) / (T.glowLen * g.glow)))
      if (gk <= 0) return
      const gf = clamp01((t - T.veinFadeStart - g.delay * 0.5) / (T.veinFadeLen * g.fade))
      const reach = this.maxReach * gk * (1 - gf * gf) // lit part grows out, later drains from the tips
      const amp = g.amp * (5 + 60 * whip)              // ~65px bends during the lash, ~5px sway after
      drawVeins(ctx, this.veins, reach, this.phases[i], amp, VEIN_COLOURS, 1 - outK, i)
    })

    // ---- 4. light at the origin (behind the totem), then the totem itself
    const boneK = easeOut(clamp01((t - T.boneStart) / (T.boneEnd - T.boneStart)))
    const g = glowK * (1 - fadeK) * (1 - outK)
    if (g > 0) {
      const r = h * 0.2
      const rg = ctx.createRadialGradient(this.origin.x, this.origin.y, 0, this.origin.x, this.origin.y, r)
      rg.addColorStop(0, `rgba(120,220,255,${0.5 * g})`)
      rg.addColorStop(1, 'rgba(40,120,255,0)')
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = rg
      ctx.fillRect(this.origin.x - r, this.origin.y - r, r * 2, r * 2)
      ctx.restore()
    }
    if (boneK > 0) {
      const tw = this.totem.width, th = this.totem.height
      const scale = 0.75 + 0.25 * boneK
      const bob = Math.sin(secs * 1.3) * 3 // slow floating
      ctx.save()
      ctx.globalAlpha = boneK * (1 - outK)
      ctx.translate(this.origin.x, this.origin.y + (1 - boneK) * -25 + bob)
      ctx.scale(scale, scale)
      ctx.drawImage(this.totem, -tw / 2, -th * 0.18)
      ctx.restore()
    }

    // ---- 5. you, in front of the totem: dark blue with a cyan rim (like the reference)
    if (mask && boneK > 0) this.body.draw(ctx, video, mask, w, h, boneK * (1 - outK), '#7fe8ff', '#1d3f8a')
  }

  /** dark red perspective grid on the floor */
  private drawGrid(ctx: CanvasRenderingContext2D, a: number) {
    if (a <= 0) return
    const { w, h } = this
    const horizon = h * 0.56, vx = w / 2
    ctx.save()
    ctx.strokeStyle = `rgba(190,25,40,${0.32 * a})`
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = -14; i <= 14; i++) { ctx.moveTo(vx + i * 6, horizon); ctx.lineTo(vx + i * 95, h + 20) } // converging lines
    for (let k = 1; k <= 9; k++) { const y = horizon + (h - horizon) * Math.pow(k / 9, 1.8); ctx.moveTo(0, y); ctx.lineTo(w, y) }
    ctx.stroke()
    ctx.restore()
  }

  /**
   * The bone totem, drawn ONCE per cast onto its own canvas (it doesn't change shape), then
   * just placed each frame. Stacked bony plates with ridges and side spurs, dark, lit only by a
   * faint cyan rim from the veins, and mostly drowned in shadow — "hidden".
   */
  private bakeTotem() {
    const H = this.h * 0.6, W = H * 0.6
    const c = this.totem
    c.width = Math.ceil(W * 1.6)
    c.height = Math.ceil(H)
    const g = c.getContext('2d')!
    g.translate(c.width / 2, 0)
    g.lineJoin = 'round'

    const plate = (y: number, pw: number, ph: number, spur: number) => {
      // one bony plate: a rounded, slightly pointed shield shape with side spurs
      g.beginPath()
      g.moveTo(-pw / 2, y)
      g.quadraticCurveTo(0, y - ph * 0.35, pw / 2, y)
      g.lineTo(pw / 2 + spur, y + ph * 0.35)                 // right spur
      g.lineTo(pw / 2 - pw * 0.06, y + ph * 0.55)
      g.quadraticCurveTo(pw * 0.3, y + ph, 0, y + ph * 1.05)
      g.quadraticCurveTo(-pw * 0.3, y + ph, -pw / 2 + pw * 0.06, y + ph * 0.55)
      g.lineTo(-pw / 2 - spur, y + ph * 0.35)               // left spur
      g.closePath()
      const grad = g.createLinearGradient(-pw / 2, y, pw / 2, y + ph)
      grad.addColorStop(0, '#2a3446')
      grad.addColorStop(0.6, '#161c28')
      grad.addColorStop(1, '#0b0e15')
      g.fillStyle = grad
      g.fill()
      g.strokeStyle = '#020306'
      g.lineWidth = 2.2
      g.stroke()
      // ridges across the plate
      g.strokeStyle = 'rgba(0,0,0,0.75)'
      g.lineWidth = 1.2
      for (let r = 1; r <= 2; r++) {
        g.beginPath()
        g.moveTo(-pw * 0.38, y + ph * 0.28 * r)
        g.quadraticCurveTo(0, y + ph * 0.28 * r + ph * 0.12, pw * 0.38, y + ph * 0.28 * r)
        g.stroke()
      }
      // cyan rim light on the right edge (light coming from the veins)
      g.strokeStyle = 'rgba(110,225,255,0.4)'
      g.lineWidth = 1.4
      g.beginPath()
      g.moveTo(pw * 0.15, y - ph * 0.15)
      g.quadraticCurveTo(pw * 0.42, y - ph * 0.02, pw / 2 + spur * 0.8, y + ph * 0.32)
      g.stroke()
    }

    // crown (widest, like a mask/skull), then plates narrowing downward
    const rows = [
      { pw: W * 1.0, ph: H * 0.16, spur: W * 0.12 },
      { pw: W * 0.82, ph: H * 0.13, spur: W * 0.16 },
      { pw: W * 0.9, ph: H * 0.13, spur: W * 0.08 },
      { pw: W * 0.66, ph: H * 0.12, spur: W * 0.14 },
      { pw: W * 0.52, ph: H * 0.11, spur: W * 0.06 },
    ]
    let y = H * 0.04
    for (const r of rows) { plate(y, r.pw, r.ph, r.spur); y += r.ph * 0.82 }

    // hanging spine + knot + tassel strands at the bottom
    g.strokeStyle = '#0d1119'
    g.lineWidth = 4
    g.beginPath(); g.moveTo(0, y); g.lineTo(0, H * 0.88); g.stroke()
    g.fillStyle = '#1a2130'
    g.beginPath(); g.ellipse(0, y + H * 0.05, W * 0.09, H * 0.025, 0, 0, Math.PI * 2); g.fill(); g.stroke()
    g.lineWidth = 1.3
    for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(i * 2, H * 0.8); g.lineTo(i * 5, H * 0.98); g.stroke() }

    // drown it in shadow: dark radial veil, lighter only near the top centre
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.globalCompositeOperation = 'source-atop'
    const veil = g.createRadialGradient(c.width * 0.55, H * 0.15, 0, c.width / 2, H * 0.4, H * 0.75)
    veil.addColorStop(0, 'rgba(0,0,0,0.15)')
    veil.addColorStop(0.6, 'rgba(0,0,0,0.6)')
    veil.addColorStop(1, 'rgba(0,0,0,0.92)')
    g.fillStyle = veil
    g.fillRect(0, 0, c.width, c.height)
  }
}
