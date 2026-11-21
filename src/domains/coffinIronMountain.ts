// Coffin of the Iron Mountain — Jogo's domain.
//
// Timeline (9s):
//   0.0  DARK     the room darkens, creeping in from the edges
//   0.2  ROCKS    huge volcanic rocks close in from behind: a boulder ceiling drops from above,
//                 walls slide in from the sides (each one lands with a thud)
//   2.4  RUPTURE  the floor cracks open: bottom of the screen glows, violent shake
//   3.0  ERUPTION light floods the whole cave, rocks light up from below, cracks in them glow,
//                 embers fly up, the air shimmers with heat haze
//   8.1  END      fades back to the room
//
// New here: procedural rocks (baked once, in a dark + a lit version that we crossfade), the lava
// floor, embers, and the HeatHaze component. Reused: NoiseDissolve, BodyLayer, ScreenShake, title.

import { Domain, clamp01, rand, easeOut, type DomainInputs } from './domain'
import { NoiseDissolve } from '../fx/noiseDissolve'
import { HeatHaze } from '../fx/heatHaze'

const T = {
  darken: 1200,
  rocksStart: 200, rocksLen: 1900,
  rupture: 2400,
  flood: 3000, floodLen: 1000,
  end: 9000,
}

type Rock = {
  dark: HTMLCanvasElement   // unlit rock
  lit: HTMLCanvasElement    // same rock lit from below by lava, glowing cracks
  x: number; y: number      // final position (centre)
  fromX: number; fromY: number // where it slides in from
  delay: number
  landed: boolean
}
type Ember = { x: number; y: number; vx: number; vy: number; size: number; life: number; age: number; hue: number }

export class CoffinIronMountain extends Domain {
  private dark = new NoiseDissolve({ width: 160, height: 120, layers: [{ radius: 3, weight: 1.2 }], centreBias: -1 })
  private haze = new HeatHaze()
  private rocks: Rock[] = []
  private embers: Ember[] = []
  private floorCracks = document.createElement('canvas')
  private ruptured = false

  constructor() {
    super({
      id: 'coffin_iron_mountain',
      name: 'COFFIN OF THE IRON MOUNTAIN',
      theme: 'coffin',
      duration: T.end,
      fadeOut: 900,
      title: { showDE: 2600, showName: 3200, fade: 7000, end: T.end },
    })
  }

  protected onStart() {
    const { w, h } = this
    this.dark.reseed()
    this.ruptured = false
    this.embers = []
    this.bakeFloorCracks()

    // rock layout: a ceiling of big boulders, walls on both sides, a few low corner rocks.
    // Each slides in from OFF-SCREEN in the direction it sits (ceiling from above, walls from sides).
    const R = Math.max(w, h)
    const layout = [
      // sizes are fractions of the screen's long side; positions of the screen (0..1)
      { x: 0.5, y: -0.12, r: 0.8, from: [0, -1], delay: 0 },      // the massive overhead boulder
      { x: 0.05, y: 0.02, r: 0.55, from: [-0.5, -1], delay: 180 },
      { x: 0.95, y: 0.0, r: 0.55, from: [0.5, -1], delay: 120 },
      { x: -0.08, y: 0.5, r: 0.45, from: [-1, 0], delay: 420 },   // left wall
      { x: 1.08, y: 0.52, r: 0.45, from: [1, 0], delay: 380 },    // right wall
      { x: -0.03, y: 0.95, r: 0.3, from: [-1, 0.3], delay: 650 },
      { x: 1.03, y: 0.97, r: 0.3, from: [1, 0.3], delay: 600 },
    ]
    this.rocks = layout.map((l) => {
      const size = l.r * R
      const { dark, lit } = this.bakeRock(size)
      return {
        dark, lit,
        x: l.x * w, y: l.y * h,
        fromX: l.x * w + l.from[0] * size * 1.6, fromY: l.y * h + l.from[1] * size * 1.6,
        delay: l.delay, landed: false,
      }
    })
  }

  protected draw(ctx: CanvasRenderingContext2D, { video, mask }: DomainInputs, t: number, dtMs: number) {
    const { w, h } = this
    const secs = t / 1000
    const fade = this.endFade
    const darkK = easeOut(clamp01(t / T.darken))
    const crackK = clamp01((t - T.rupture) / (T.flood - T.rupture))      // floor starts glowing
    const light = easeOut(clamp01((t - T.flood) / T.floodLen))           // the whole cave lights up

    // ---- camera
    if (!this.ruptured && t > T.rupture) { this.ruptured = true; this.shake.kick(26) }
    const rumble = t < T.rupture ? 0.8 : t < T.flood + 600 ? 6 * (1 - light) + 3 : 1.6
    this.shake.update(dtMs, rumble, 1, 0.86)

    // ---- 1. room goes dark (edges first), then a cave background behind everything
    this.dark.draw(ctx, darkK * 2.4 - 0.6, 'below', 6, [14, 6, 4])
    ctx.globalAlpha = fade
    if (darkK > 0.6) {
      const bg = ctx.createLinearGradient(0, 0, 0, h)
      bg.addColorStop(0, `rgb(${20 + 40 * light},${8 + 10 * light},${5})`)
      bg.addColorStop(1, `rgb(${30 + 150 * light},${10 + 50 * light},${6 + 8 * light})`)
      ctx.globalAlpha = fade * clamp01((darkK - 0.6) / 0.4)
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)
      ctx.globalAlpha = fade
    }

    // ---- 2. lava floor: glows when the ground ruptures, blazes once the cave lights up
    const lavaK = Math.max(crackK * 0.6, light)
    if (lavaK > 0) this.drawLava(ctx, secs, lavaK, fade)

    // ---- 3. rocks slide in; each lands with a thud; later they're lit from below
    for (const r of this.rocks) {
      const k = clamp01((t - T.rocksStart - r.delay) / (T.rocksLen * 0.6))
      if (k <= 0) continue
      if (!r.landed && k >= 1) { r.landed = true; this.shake.kick(7) }
      const e = 1 - Math.pow(1 - k, 3) // strong ease-out: fast slide, heavy stop
      const x = r.fromX + (r.x - r.fromX) * e, y = r.fromY + (r.y - r.fromY) * e
      const s = r.dark.width
      ctx.globalAlpha = fade
      ctx.drawImage(r.dark, x - s / 2, y - s / 2)
      if (lavaK > 0) {
        // flicker the lava light slightly, like fire
        ctx.globalAlpha = fade * lavaK * (0.85 + 0.15 * Math.sin(secs * 9 + r.delay))
        ctx.drawImage(r.lit, x - s / 2, y - s / 2)
      }
    }
    ctx.globalAlpha = fade

    // ---- 4. you, with an orange rim from the lava light
    if (mask && darkK > 0.3) this.body.draw(ctx, video, mask, w, h, fade * clamp01((darkK - 0.3) / 0.7), '#ffa14a')

    // ---- 5. embers rising (only once there's fire)
    if (lavaK > 0.2) this.drawEmbers(ctx, dtMs, lavaK, fade)

    // ---- 6. warm light wash over everything
    if (light > 0) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const g = ctx.createRadialGradient(w / 2, h * 1.1, h * 0.1, w / 2, h * 1.1, h * 1.2)
      g.addColorStop(0, `rgba(255,150,40,${0.35 * light * fade})`)
      g.addColorStop(1, 'rgba(255,60,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      ctx.restore()
    }

    // ---- 7. heat haze over the finished frame
    this.haze.apply(ctx, secs, light * fade)
  }

  private drawLava(ctx: CanvasRenderingContext2D, secs: number, k: number, fade: number) {
    const { w, h } = this
    const top = h * (0.86 - 0.08 * k) // the glowing band rises a bit as it erupts
    ctx.save()
    const g = ctx.createLinearGradient(0, top - h * 0.12, 0, h)
    g.addColorStop(0, 'rgba(255,80,0,0)')
    g.addColorStop(0.35, `rgba(220,60,5,${0.7 * k})`)
    g.addColorStop(0.7, `rgba(255,140,20,${0.95 * k})`)
    g.addColorStop(1, `rgba(255,220,120,${k})`)
    ctx.globalAlpha = fade
    ctx.fillStyle = g
    ctx.fillRect(0, top - h * 0.12, w, h - top + h * 0.12)
    // bubbling hot spots drifting along the floor
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 9; i++) {
      const x = ((i / 9) * w + secs * (20 + i * 7) * (i % 2 ? 1 : -1) + w * 2) % w
      const y = h - (8 + (i % 3) * 14) - Math.sin(secs * 3 + i) * 5
      const r = 30 + (i % 4) * 14
      const spot = ctx.createRadialGradient(x, y, 0, x, y, r)
      spot.addColorStop(0, `rgba(255,230,140,${0.55 * k})`)
      spot.addColorStop(1, 'rgba(255,120,0,0)')
      ctx.fillStyle = spot
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }
    // glowing cracks in the ground
    ctx.globalAlpha = fade * k
    ctx.drawImage(this.floorCracks, 0, 0)
    ctx.restore()
  }

  private drawEmbers(ctx: CanvasRenderingContext2D, dtMs: number, k: number, fade: number) {
    const { w, h } = this
    const dt = dtMs / 1000
    while (this.embers.length < 90 * k) {
      const life = rand(1.2, 3)
      this.embers.push({
        x: Math.random() * w, y: h + rand(0, 20), vx: rand(-25, 25), vy: -rand(60, 220),
        size: rand(0.8, 2.6), life, age: 0, hue: rand(20, 50),
      })
    }
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    this.embers = this.embers.filter((e) => {
      e.age += dt
      e.x += (e.vx + Math.sin(e.age * 4 + e.y * 0.02) * 30) * dt // drifting in hot air
      e.y += e.vy * dt
      if (e.age > e.life || e.y < -10) return false
      const a = (1 - e.age / e.life) * fade
      ctx.fillStyle = `hsla(${e.hue},100%,${55 + 20 * (1 - e.age / e.life)}%,${a})`
      ctx.fillRect(e.x, e.y, e.size, e.size * 1.6)
      return true
    })
    ctx.restore()
  }

  /**
   * One rock, baked twice: DARK (unlit) and LIT (lava light from below + glowing cracks).
   * Shape = a circle whose radius wobbles (sum of a few sine waves + noise) -> craggy boulder.
   */
  private bakeRock(size: number) {
    const make = () => { const c = document.createElement('canvas'); c.width = c.height = Math.ceil(size); return c }
    const dark = make(), lit = make()
    const cx = size / 2, cy = size / 2, R = size * 0.46
    const seeds = [rand(0, 9), rand(0, 9), rand(0, 9)]
    const N = 60
    const pts: [number, number][] = []
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2
      const wob = 1 + 0.12 * Math.sin(a * 3 + seeds[0]) + 0.07 * Math.sin(a * 7 + seeds[1]) + 0.05 * Math.sin(a * 13 + seeds[2]) + rand(-0.03, 0.03)
      pts.push([cx + Math.cos(a) * R * wob, cy + Math.sin(a) * R * wob * 0.85])
    }
    const shape = (g: CanvasRenderingContext2D) => {
      g.beginPath()
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
      g.closePath()
    }
    // cracks: short random walks across the rock
    const cracks: [number, number][][] = []
    for (let c = 0; c < 7; c++) {
      let x = cx + rand(-R, R) * 0.6, y = cy + rand(-R, R) * 0.5, a = rand(0, Math.PI * 2)
      const line: [number, number][] = [[x, y]]
      for (let s = 0; s < 14; s++) { a += rand(-0.6, 0.6); x += Math.cos(a) * size * 0.03; y += Math.sin(a) * size * 0.03; line.push([x, y]) }
      cracks.push(line)
    }

    // --- dark version
    let g = dark.getContext('2d')!
    shape(g)
    const base = g.createRadialGradient(cx - R * 0.3, cy - R * 0.4, R * 0.1, cx, cy, R * 1.1)
    base.addColorStop(0, '#3a2219')
    base.addColorStop(1, '#0c0605')
    g.fillStyle = base
    g.fill()
    g.save(); g.clip()
    for (let i = 0; i < 14; i++) { // pits and bumps
      g.fillStyle = `rgba(0,0,0,${rand(0.15, 0.4)})`
      g.beginPath(); g.ellipse(cx + rand(-R, R), cy + rand(-R, R), rand(4, R * 0.18), rand(3, R * 0.12), rand(0, 3), 0, Math.PI * 2); g.fill()
    }
    g.strokeStyle = 'rgba(0,0,0,0.6)'
    g.lineWidth = Math.max(1, size * 0.006)
    for (const l of cracks) { g.beginPath(); l.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke() }
    g.restore()
    shape(g); g.strokeStyle = '#050202'; g.lineWidth = 3; g.stroke()

    // --- lit version: lava light from BELOW, glowing cracks
    g = lit.getContext('2d')!
    g.save()
    shape(g); g.clip()
    const glow = g.createLinearGradient(0, cy + R, 0, cy - R)
    glow.addColorStop(0, 'rgba(255,170,60,0.95)')
    glow.addColorStop(0.45, 'rgba(200,70,15,0.55)')
    glow.addColorStop(1, 'rgba(60,15,5,0)')
    g.fillStyle = glow
    g.fillRect(0, 0, size, size)
    g.globalCompositeOperation = 'lighter'
    for (const l of cracks) {
      for (const [lw, col] of [[size * 0.03, 'rgba(255,90,10,0.25)'], [size * 0.012, 'rgba(255,170,50,0.8)'], [size * 0.004, 'rgba(255,240,180,1)']] as const) {
        g.strokeStyle = col
        g.lineWidth = Math.max(0.8, lw)
        g.beginPath(); l.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke()
      }
    }
    g.restore()
    return { dark, lit }
  }

  /** glowing cracks across the floor, converging toward the middle (fake perspective) */
  private bakeFloorCracks() {
    const { w, h } = this
    const c = this.floorCracks
    c.width = w; c.height = h
    const g = c.getContext('2d')!
    g.clearRect(0, 0, w, h)
    g.lineCap = 'round'
    for (let i = 0; i < 12; i++) {
      let x = rand(0, w), y = h + 5
      const pts: [number, number][] = [[x, y]]
      const targetX = w / 2 + rand(-w * 0.25, w * 0.25)
      for (let s = 0; s < 18; s++) {
        x += (targetX - x) * 0.06 + rand(-10, 10)
        y -= rand(3, 8)
        pts.push([x, y])
        if (y < h * 0.8) break
      }
      for (const [lw, col] of [[7, 'rgba(255,90,0,0.25)'], [3, 'rgba(255,170,40,0.8)'], [1.2, 'rgba(255,245,200,1)']] as const) {
        g.strokeStyle = col
        g.lineWidth = lw
        g.beginPath(); pts.forEach(([px, py], j) => (j ? g.lineTo(px, py) : g.moveTo(px, py))); g.stroke()
      }
    }
  }
}
