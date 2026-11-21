// Malevolent Shrine — Sukuna's domain.
//
// Layers, back to front, each frame:
//   1. the room dissolves into black (red burning edges)       <- NoiseDissolve component
//   2. back red specks
//   3. you, cut out, with a white rim                           <- BodyLayer (from Domain)
//   4. your face blacked out + Sukuna's four red eyes           <- SukunaFace
//   5. front red specks
//   6. blade slashes                                            <- blade.ts shapes
//
// ONE number drives the mood: `intensity`, 1 at peak chaos -> 0 as the domain dies.
// Slash rate/size/speed, shake strength/roughness and speck speed all read from it.

import { Domain, clamp01, rand, type DomainInputs } from './domain'
import { makeBlade, bladePath, type Blade } from '../fx/blade'
import { NoiseDissolve } from '../fx/noiseDissolve'
import { SukunaFace } from '../fx/sukunaFace'

type Speck = {
  x: number; y: number; vx: number; vy: number
  size: number; a: number; color: string
  front: boolean; streak: boolean
  wobble: number; phase: number
}
type Slash = { blade: Blade; shards: Blade[]; born: number; life: number; line: number }

const T = {
  cut: 1100,        // the cut through "DOMAIN EXPANSION" + big kick
  fx: 1250,         // chaos begins
  dissolve: 900,    // room -> black
  peakUntil: 3200,  // ~2s of overwhelming chaos...
  end: 7000,        // ...then it winds down until here
}

// darker, blood-ish reds
const REDS = ['#4a0000', '#6b0000', '#8a0505', '#a00a0a', '#5c0a0a', '#c01010']

export class MalevolentShrine extends Domain {
  private specks: Speck[] = []
  private slashes: Slash[] = []
  private nextSlash = 0
  private opened = false
  private kicked = false
  private sukuna = new SukunaFace()
  private dissolve = new NoiseDissolve({
    width: 160, height: 120,
    layers: [{ radius: 2, weight: 1 }],
    centreBias: -0.9, // negative: edges go black first, darkness creeps inward
  })

  constructor() {
    super({
      id: 'malevolent_shrine',
      name: 'MALEVOLENT SHRINE',
      theme: 'shrine',
      duration: T.end,
      fadeOut: 900,
      title: { showDE: 100, showName: T.cut, fade: 5600, end: T.end },
      cutTitle: true,
      needsFace: true,
      post: { bloom: 0.7, threshold: 0.55, contrast: 1.12, vignette: 0.45 },
    })
  }

  /** 0 before chaos, 1 at peak, easing down to 0 at the end */
  private intensity(t: number) {
    if (t < T.fx) return 0
    if (t < T.peakUntil) return 1
    const k = clamp01((t - T.peakUntil) / (T.end - T.peakUntil))
    return (1 - k) * (1 - k)
  }

  protected onStart() {
    this.slashes = []
    this.opened = false
    this.kicked = false
    this.nextSlash = performance.now() + T.fx
    this.specks = Array.from({ length: 55 }, () => this.newSpeck(true))
    this.dissolve.reseed()
    this.sukuna.reset()
  }

  protected draw(ctx: CanvasRenderingContext2D, { video, mask, face }: DomainInputs, t: number, dtMs: number) {
    const now = performance.now()
    const { w, h } = this
    const I = this.intensity(t)
    const fxAmt = clamp01((t - T.fx) / T.dissolve)
    const fade = this.endFade
    ctx.globalAlpha = fade

    if (!this.kicked && t >= T.cut) { this.kicked = true; this.shake.kick(22) }
    // rough + snappy at peak, smooth + slow as it dies
    this.shake.update(dtMs, 2.5 * I, I, 0.78 + 0.17 * (1 - I))

    // 1. room -> black, burning red edge (threshold rises over the dissolve time)
    if (fxAmt > 0) this.dissolve.draw(ctx, fxAmt * 1.6 - 0.4, 'below', 8, [0, 0, 0], [140, 0, 0])

    const speckDt = dtMs * (0.35 + 0.65 * I) // chaos calms down at the end
    this.drawSpecks(ctx, speckDt, now, false, fxAmt * fade)
    if (fxAmt > 0 && mask) this.body.draw(ctx, video, mask, w, h, fxAmt * fade, '#fff', undefined, true) // black silhouette
    this.sukuna.draw(ctx, face, fxAmt * fade)
    this.drawSpecks(ctx, speckDt, now, true, fxAmt * fade)

    // slashes: a flood at the opening, then frequent + big at peak, rare + small at the end
    if (!this.opened && t >= T.fx) {
      this.opened = true
      for (let i = 0; i < 8; i++) this.spawnSlash(now, 1)
    }
    if (I > 0.03 && now > this.nextSlash && this.slashes.length < 32) {
      const burst = I > 0.8 ? 2 + ((Math.random() * 3) | 0) : Math.random() < 0.3 * I ? 2 : 1
      for (let i = 0; i < burst; i++) this.spawnSlash(now, I)
      const calm = 1 - I
      this.nextSlash = now + 18 + calm * calm * 650 + Math.random() * (20 + calm * 150)
    }
    this.drawSlashes(ctx, now, fade)
  }

  private newSpeck(anywhere: boolean): Speck {
    const { w, h } = this
    const dir = Math.random() < 0.5 ? 1 : -1
    const big = Math.random() < 0.12 // chaos = variety: mostly small + fast, a few big + slow
    const speed = big ? rand(120, 400) : rand(300, 1400)
    return {
      x: anywhere ? Math.random() * w : dir > 0 ? -30 : w + 30,
      y: Math.random() * h,
      vx: dir * speed,
      vy: rand(-180, 180),
      size: big ? rand(3, 7) : rand(0.6, 2.5),
      a: big ? rand(0.25, 0.6) : rand(0.3, 1),
      color: REDS[(Math.random() * REDS.length) | 0],
      front: Math.random() < 0.4,
      streak: !big && Math.random() < 0.7,
      wobble: rand(0, 60),
      phase: rand(0, Math.PI * 2),
    }
  }

  private spawnSlash(now: number, power: number) {
    // power 1 = long, notched, fast;  power 0 = short, clean, slow
    const { w, h } = this
    const cx = Math.random() * w, cy = Math.random() * h
    const ang = Math.random() * Math.PI
    const len = (0.25 + 0.9 * power) * Math.hypot(w, h) * rand(0.7, 1.1)
    const ux = Math.cos(ang), uy = Math.sin(ang)
    const nx = -uy, ny = ux
    const x0 = cx - (ux * len) / 2, y0 = cy - (uy * len) / 2
    const x1 = cx + (ux * len) / 2, y1 = cy + (uy * len) / 2
    const maxW = (2 + 6 * power) * rand(0.7, 1.3) // THIN: length does the drama, not width
    const notches = power > 0.4 ? (Math.random() * (1 + 3 * power)) | 0 : Math.random() < 0.3 ? 1 : 0
    const blade = makeBlade(x0, y0, x1, y1, maxW, notches)

    const shards = []
    const shardCount = Math.random() < 0.6 ? 1 + ((Math.random() * 2 * power) | 0) : 0
    for (let i = 0; i < shardCount; i++) {
      const along = rand(-0.35, 0.35) * len
      const side = rand(3, 7) * maxW * (Math.random() < 0.5 ? -1 : 1)
      const sl = rand(0.07, 0.16) * len
      const sx = cx + ux * along + nx * side, sy = cy + uy * along + ny * side
      const a2 = ang + rand(-0.3, 0.3)
      shards.push(makeBlade(
        sx - (Math.cos(a2) * sl) / 2, sy - (Math.sin(a2) * sl) / 2,
        sx + (Math.cos(a2) * sl) / 2, sy + (Math.sin(a2) * sl) / 2,
        Math.max(1.2, Math.min(maxW * rand(0.4, 0.7), sl * 0.08)), 0,
      ))
    }
    this.slashes.push({ blade, shards, born: now, life: 260 + (1 - power) * 500, line: 1.2 + 0.8 * power })
    this.shake.kick(4 + 20 * power) // each slash kicks the camera
  }

  private drawSpecks(ctx: CanvasRenderingContext2D, dtMs: number, now: number, front: boolean, amt: number) {
    if (amt <= 0) return
    const { w, h } = this
    const dt = dtMs / 1000
    for (let i = 0; i < this.specks.length; i++) {
      const s = this.specks[i]
      if (s.front !== front) continue
      s.x += s.vx * dt
      s.y += s.vy * dt + Math.sin(now / 90 + s.phase) * s.wobble * dt
      if (Math.random() < 0.02) s.vy = rand(-250, 250) // random lurches
      if (s.x < -40 || s.x > w + 40 || s.y < -40 || s.y > h + 40) { this.specks[i] = this.newSpeck(false); continue }
      ctx.globalAlpha = s.a * amt * (0.7 + Math.random() * 0.3)
      if (s.streak) {
        ctx.strokeStyle = s.color
        ctx.lineWidth = s.size
        ctx.beginPath()
        ctx.moveTo(s.x - s.vx * 0.018, s.y - s.vy * 0.018)
        ctx.lineTo(s.x, s.y)
        ctx.stroke()
      } else {
        ctx.fillStyle = s.color
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
  }

  private drawSlashes(ctx: CanvasRenderingContext2D, now: number, fade: number) {
    ctx.lineJoin = 'miter'
    ctx.miterLimit = 6
    this.slashes = this.slashes.filter((s) => now - s.born < s.life)
    for (const s of this.slashes) {
      const p = (now - s.born) / s.life
      const reveal = clamp01(p / 0.2) // shoots out, holds, fades
      const a = (1 - clamp01((p - 0.55) / 0.45)) * fade
      ctx.beginPath()
      bladePath(ctx, s.blade, reveal)
      if (reveal >= 1) for (const sh of s.shards) bladePath(ctx, sh)
      // black fill + white outline; a faint wide white stroke underneath = cheap glow
      ctx.globalAlpha = a * 0.22
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = s.line * 4
      ctx.stroke()
      ctx.globalAlpha = a
      ctx.fillStyle = '#000'
      ctx.fill()
      ctx.lineWidth = s.line
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }
}
