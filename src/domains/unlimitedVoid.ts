// Unlimited Void — Gojo's domain.
//
// Timeline:
//   0.0s  BUILD   the room behind you floods white, glow pulses and swells, screen rumbles
//   1.5s  BURST   full white flash -> white ink splatter blasts outward -> the void is revealed
//   1.5s+ VOID    deep space + a moving black hole (swirl, glowing ring, accretion disk,
//                 orbiting hot spots) + light purple/pink streaks flying past you
//   end   fades back to the room
//
// PERFORMANCE IDEA: PRE-RENDERED TEXTURES.
// The swirl (hundreds of curved strokes) and star field would be far too slow to draw from
// scratch every frame. So at cast time we draw them ONCE onto offscreen canvases, and each
// frame we just draw those images ROTATED by a growing angle. Rotating an image is nearly free
// for the GPU, but it reads as constant motion. Big games do the same with "baked" textures.

import { Domain, clamp01, rand, easeOut, type DomainInputs } from './domain'
import { NoiseDissolve } from '../fx/noiseDissolve'

const T = {
  burst: 1500,      // white build-up length
  flash: 550,       // how long the white flash takes to clear
  splatter: 2400,   // ink splatter lifetime
  end: 9000,
}

const STREAK_COLORS = ['#d9b8ff', '#c8a2ff', '#ffc2ec', '#f3d2ff', '#ffb0e0', '#b9a4ff'] // light purple / pink

type Streak = { ang: number; d: number; speed: number; color: string; width: number }

export class UnlimitedVoid extends Domain {
  private R = 80 // black hole radius
  private swirl = document.createElement('canvas')
  private stars = document.createElement('canvas')
  private streaks: Streak[] = []
  // the white burst, eaten away like ink: centre clears first, splatter lingers at the edges
  private ink = new NoiseDissolve({
    width: 320, height: 240,
    layers: [{ radius: 11, weight: 3 }, { radius: 3, weight: 0.5 }], // big blobs + a little detail
    centreBias: 2.2,
  })

  constructor() {
    super({
      id: 'infinite_void',
      name: 'UNLIMITED VOID',
      theme: 'void',
      duration: T.end,
      fadeOut: 900,
      title: { showDE: 1700, showName: 2500, fade: 6800, end: T.end },
    })
  }

  protected onStart() {
    this.R = this.h * 0.15
    this.bakeTextures()
    this.streaks = Array.from({ length: 70 }, () => this.newStreak(true))
    this.ink.reseed() // new random splatter pattern every cast
  }

  // ---------- textures baked once per cast ----------
  private bakeTextures() {
    const { w, h, R } = this
    // SWIRL: a big square of curved, faint blue-white strokes circling the centre.
    // Strokes near the hole are brighter and tighter; far ones are faint wisps.
    const S = Math.ceil(Math.hypot(w, h) * 1.1)
    this.swirl.width = this.swirl.height = S
    const g = this.swirl.getContext('2d')!
    g.translate(S / 2, S / 2)
    g.globalCompositeOperation = 'lighter' // overlapping strokes ADD UP light, like real glow
    // baked with a blur: smeared, wispy light instead of hard stripes. Blur is slow, but this
    // runs ONCE per cast, never per frame — that's the whole point of baking.
    g.filter = 'blur(3px)'
    for (let i = 0; i < 220; i++) {
      const r = R * 1.15 + Math.pow(Math.random(), 2.2) * (S / 2 - R) // most strokes near the hole
      const near = 1 - (r - R) / (S / 2)
      const a0 = Math.random() * Math.PI * 2
      const sweep = rand(0.2, 0.9) * (0.5 + near)
      g.beginPath()
      g.arc(0, 0, r, a0, a0 + sweep)
      const blueish = Math.random() < 0.35
      const a = (0.02 + 0.16 * near * near) * (Math.random() < 0.15 ? 2.5 : 1) // a few brighter wisps
      g.strokeStyle = blueish ? `rgba(120,170,255,${a})` : `rgba(225,235,255,${a})`
      g.lineWidth = rand(2, 6) + near * rand(4, 14)
      g.stroke()
    }
    g.filter = 'none'

    // STARS: tiny dots, a few brighter ones
    this.stars.width = w; this.stars.height = h
    const s = this.stars.getContext('2d')!
    s.fillStyle = '#02030a'
    s.fillRect(0, 0, w, h)
    for (let i = 0; i < 260; i++) {
      s.fillStyle = `rgba(${200 + rand(0, 55)},${210 + rand(0, 45)},255,${rand(0.15, 0.9)})`
      const size = Math.random() < 0.06 ? 1.8 : rand(0.4, 1.1)
      s.fillRect(Math.random() * w, Math.random() * h, size, size)
    }
  }

  private newStreak(anywhere: boolean): Streak {
    return {
      ang: Math.random() * Math.PI * 2,
      d: anywhere ? rand(this.R * 1.3, Math.hypot(this.w, this.h) / 2) : rand(this.R * 1.2, this.R * 2),
      speed: rand(0.6, 1.4),
      color: STREAK_COLORS[(Math.random() * STREAK_COLORS.length) | 0],
      width: rand(0.8, 2.6),
    }
  }

  // ---------- per frame ----------
  protected draw(ctx: CanvasRenderingContext2D, { video, mask }: DomainInputs, t: number, dtMs: number) {
    const { w, h } = this
    const dt = dtMs / 1000
    // CAMERA: during the build it slowly pushes IN (pressure). At the burst it snaps to a wide
    // zoom and eases back out to normal = the "blown back" feeling, plus a big kick of shake.
    if (t < T.burst) {
      this.shake.zoom = 1 + 0.06 * (t / T.burst) ** 2
      this.shake.update(dtMs, 1 + 7 * (t / T.burst) ** 2, 1)
    } else {
      if (t - dtMs < T.burst) this.shake.kick(22)
      const z = clamp01((t - T.burst) / 900)
      this.shake.zoom = 1 + 0.2 * (1 - easeOut(z)) * (1 - easeOut(z)) // 1.2x -> 1x, fast then gentle
      this.shake.update(dtMs, 0.6, 1, 0.88)
    }

    if (t < T.burst) {
      this.drawBuild(ctx, video, mask, t, w, h)
      return
    }

    const tv = t - T.burst
    const fade = this.endFade
    ctx.globalAlpha = fade
    this.drawVoid(ctx, tv, w, h, dt)
    if (mask) this.body.draw(ctx, video, mask, w, h, fade, '#d6e6ff')

    // white burst layer over everything, dissolving like ink (threshold sweeps fast, then slows)
    const k = tv / T.splatter
    if (k < 1) {
      ctx.save()
      ctx.globalAlpha = fade * (1 - k * k * k)
      this.ink.draw(ctx, -1.2 + easeOut(k) * 3.4, 'above', 6, [245, 248, 255])
      ctx.restore()
    }

    // the burst flash: white over EVERYTHING, clearing quickly
    const flash = 1 - clamp01(tv / T.flash)
    if (flash > 0) {
      ctx.globalAlpha = flash * flash
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, w, h)
    }
  }

  /** BUILD: the room behind you turns white; a glow swells until it swallows you too. */
  private drawBuild(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, mask: HTMLCanvasElement | null, t: number, w: number, h: number) {
    const k = t / T.burst                      // 0 -> 1
    const pulse = 0.5 + 0.5 * Math.sin(t / 60) // flicker, getting faster isn't needed: it's short

    // 1. background goes white (behind you)
    ctx.globalAlpha = easeOut(clamp01(k * 1.4))
    ctx.fillStyle = '#f4f8ff'
    ctx.fillRect(0, 0, w, h)
    ctx.globalAlpha = 1

    // 2. you stay in front, with a bright rim
    if (mask) this.body.draw(ctx, video, mask, w, h, 1, '#ffffff')

    // 3. a glow swells from the centre and finally covers you too (k > 0.7)
    const r = Math.hypot(w, h) * (0.15 + 0.9 * k * k)
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r)
    const core = clamp01((k - 0.55) / 0.45)
    g.addColorStop(0, `rgba(255,255,255,${0.35 + 0.65 * core})`)
    g.addColorStop(0.5, `rgba(225,235,255,${(0.2 + 0.3 * pulse) * k})`)
    g.addColorStop(1, 'rgba(200,215,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  /** VOID: stars, swirl, black hole with ring + disk, flying streaks */
  private drawVoid(ctx: CanvasRenderingContext2D, tv: number, w: number, h: number, dt: number) {
    const cx = w / 2, cy = h * 0.46, R = this.R
    const secs = tv / 1000
    const grow = easeOut(clamp01(tv / 900)) // the hole opens up after the burst

    // stars, very slowly drifting (parallax = depth)
    ctx.drawImage(this.stars, Math.sin(secs * 0.2) * 6, Math.cos(secs * 0.15) * 4)

    // the swirl: TWO copies of the same texture spinning at different speeds and directions.
    // Where they overlap the light shifts and churns, so it never looks like a static image.
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const S = this.swirl.width
    for (const [speed, alpha, scale] of [[0.35, 0.9, 1], [-0.18, 0.5, 1.25]] as const) {
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(secs * speed)
      ctx.scale(scale * grow, scale * grow)
      ctx.globalAlpha *= alpha
      ctx.drawImage(this.swirl, -S / 2, -S / 2)
      ctx.restore()
    }

    // accretion disk, BACK half (behind the hole): a flattened glowing ring
    this.drawDisk(ctx, cx, cy, R * grow, secs, 'back')

    // lensed glow ring around the hole (soft, wide)
    const halo = ctx.createRadialGradient(cx, cy, R * 0.9 * grow, cx, cy, R * 1.9 * grow)
    halo.addColorStop(0, 'rgba(255,255,255,0.0)')
    halo.addColorStop(0.15, 'rgba(240,245,255,0.85)')
    halo.addColorStop(0.4, 'rgba(160,190,255,0.25)')
    halo.addColorStop(1, 'rgba(120,150,255,0)')
    ctx.fillStyle = halo
    ctx.beginPath()
    ctx.arc(cx, cy, R * 1.9 * grow, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    // the hole itself: pure black with a very soft edge
    const hole = ctx.createRadialGradient(cx, cy, R * 0.75 * grow, cx, cy, R * 1.02 * grow)
    hole.addColorStop(0, '#000')
    hole.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = hole
    ctx.beginPath()
    ctx.arc(cx, cy, R * 1.02 * grow, 0, Math.PI * 2)
    ctx.fill()

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    // photon ring: thin bright circle hugging the hole, breathing slightly
    const breathe = 1 + 0.03 * Math.sin(secs * 3)
    for (const [lw, a] of [[18, 0.07], [8, 0.18], [2.5, 0.9]] as const) {
      ctx.strokeStyle = `rgba(235,242,255,${a})`
      ctx.lineWidth = lw
      ctx.beginPath()
      ctx.arc(cx, cy, R * 1.04 * grow * breathe, 0, Math.PI * 2)
      ctx.stroke()
    }
    // accretion disk, FRONT half (crosses in front of the hole, like in the reference)
    this.drawDisk(ctx, cx, cy, R * grow, secs, 'front')

    // flying streaks: start near the hole, rush outward and speed up, stretching as they go.
    // Moving AWAY from the centre = it feels like you're flying INTO the void.
    const maxD = Math.hypot(w, h) / 2 + 40
    for (let i = 0; i < this.streaks.length; i++) {
      const s = this.streaks[i]
      s.d += (90 + s.d * 1.6) * s.speed * dt
      if (s.d > maxD) { this.streaks[i] = this.newStreak(false); continue }
      const len = 6 + s.d * 0.16
      const c = Math.cos(s.ang), sn = Math.sin(s.ang)
      ctx.globalAlpha = clamp01((s.d - R * 1.2) / (R * 2)) * 0.9 * grow
      ctx.strokeStyle = s.color
      ctx.lineWidth = s.width * (0.6 + s.d / maxD)
      ctx.beginPath()
      ctx.moveTo(cx + c * s.d, cy + sn * s.d)
      ctx.lineTo(cx + c * (s.d + len), cy + sn * (s.d + len))
      ctx.stroke()
    }
    ctx.restore()
    ctx.globalAlpha = 1
  }

  /** Accretion disk: a ring squashed flat (scale y), drawn in two halves so the hole sits between them. */
  private drawDisk(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, secs: number, half: 'back' | 'front') {
    if (R < 2) return
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(-0.13)
    ctx.scale(1, 0.15) // squash a circle into a thin ellipse = a disk seen almost edge-on
    const g = ctx.createRadialGradient(0, 0, R * 1.15, 0, 0, R * 3.6)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(0.12, 'rgba(255,255,255,0.95)')
    g.addColorStop(0.35, 'rgba(200,215,255,0.55)')
    g.addColorStop(0.7, 'rgba(150,170,255,0.15)')
    g.addColorStop(1, 'rgba(120,140,255,0)')
    ctx.strokeStyle = g
    ctx.lineWidth = R * 2.4
    ctx.beginPath()
    // in this squashed space, the top half (PI..2PI) is the far side of the disk
    if (half === 'back') ctx.arc(0, 0, R * 2.4, Math.PI, Math.PI * 2)
    else ctx.arc(0, 0, R * 2.4, 0, Math.PI)
    ctx.stroke()

    // hot spots orbiting in the disk: bright clumps moving around = the disk visibly spins
    for (let i = 0; i < 4; i++) {
      const a = secs * (1.6 + i * 0.25) + i * 1.7
      const onFront = Math.sin(a) > 0
      if (onFront !== (half === 'front')) continue
      const rr = R * (1.9 + i * 0.35)
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr
      const spot = ctx.createRadialGradient(x, y, 0, x, y, R * 0.9)
      spot.addColorStop(0, 'rgba(255,255,255,0.8)')
      spot.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = spot
      ctx.beginPath()
      ctx.arc(x, y, R * 0.9, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }


}
