// Malevolent Shrine — the full domain effect.
//
// Everything is drawn with plain Canvas 2D (no 3D engine) so it runs on a potato.
// Each frame we paint LAYERS from back to front, like a stack of transparent sheets:
//
//   1. the room (webcam)            -> gets eaten by a black "dissolve"
//   2. back red specks              (behind you)
//   3. white glow rim               (a blurred copy of your body mask = halo)
//   4. your body                    (dark, grey, edges fading into black)
//   5. front red specks             (in front of you)
//   6. slashes                      (jagged white cuts with red glow)
//
// ONE number drives the whole mood: `intensity`, 1 at peak chaos -> 0 as the domain dies.
// Slash rate, slash size, slash speed, shake strength, shake roughness and speck speed all
// read from it. That's the trick to making an effect feel like it has an arc: don't animate
// 10 things separately, animate one "energy" value and derive everything from it.
//
// The title text is HTML/CSS (in index.html + style.css); this file just switches its classes on time.

type Speck = {
  x: number; y: number; vx: number; vy: number
  size: number; a: number; color: string
  front: boolean; streak: boolean
  wobble: number; phase: number // sideways zig-zag amount + where in the zig-zag it starts
}
type Slash = { pts: { x: number; y: number }[]; born: number; life: number; w: number }

// Timeline in ms after the cast (total 5 seconds)
const T = {
  cut: 1100,        // the slash cuts "DOMAIN EXPANSION" and the name appears
  fx: 1250,         // chaos begins
  dissolve: 900,    // how long the room takes to dissolve into black
  titleFade: 2300,  // name starts fading while the chaos takes over
  peakUntil: 2300,  // full intensity until here...
  end: 5000,        // ...then decays to 0 here
  fadeOut: 900,     // last bit: everything fades back to the room
}

// darker, blood-ish reds (not bright #ff0000)
const REDS = ['#4a0000', '#6b0000', '#8a0505', '#a00a0a', '#5c0a0a', '#c01010']

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const rand = (a: number, b: number) => a + Math.random() * (b - a)

export class MalevolentShrine {
  private started = 0
  private text = document.getElementById('shrineText')!
  private shakeEls = [document.getElementById('stage')!, document.getElementById('shrineText')!]
  private timers: number[] = []
  private specks: Speck[] = []
  private slashes: Slash[] = []
  private nextSlash = 0
  private shake = 0       // current shake strength in px (kicked by each slash, decays)
  private shakeT = 0      // time accumulator for the smooth part of the shake

  private noise: Float32Array
  private dis = document.createElement('canvas')
  private disCtx: CanvasRenderingContext2D
  private disImg: ImageData
  private glow = document.createElement('canvas')
  private body = document.createElement('canvas')
  private edge = document.createElement('canvas')

  constructor() {
    // Dissolve noise: low-res random values, blurred into blobs, edges biased to go first.
    const W = 160, H = 120
    this.dis.width = W
    this.dis.height = H
    this.disCtx = this.dis.getContext('2d')!
    this.disImg = this.disCtx.createImageData(W, H)
    const raw = new Float32Array(W * H).map(() => Math.random())
    this.noise = new Float32Array(W * H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0, n = 0
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx, yy = y + dy
            if (xx >= 0 && yy >= 0 && xx < W && yy < H) { s += raw[yy * W + xx]; n++ }
          }
        this.noise[y * W + x] = s / n - Math.hypot(x / W - 0.5, y / H - 0.5) * 0.9
      }
  }

  get active() {
    return this.started > 0 && performance.now() - this.started < T.end
  }

  /** 0 before chaos, 1 at peak, easing down to 0 at the end. */
  private intensity(t: number) {
    if (t < T.fx) return 0
    if (t < T.peakUntil) return 1
    const k = clamp01((t - T.peakUntil) / (T.end - T.peakUntil))
    return (1 - k) * (1 - k) // ease-out: drops fast at first, then lingers
  }

  start(w: number, h: number) {
    this.started = performance.now()
    this.slashes = []
    this.nextSlash = this.started + T.fx
    this.specks = Array.from({ length: 320 }, () => this.newSpeck(w, h, true))

    this.timers.forEach(clearTimeout)
    const el = this.text
    el.className = 'on'
    requestAnimationFrame(() => el.classList.add('s1'))
    this.timers = [
      window.setTimeout(() => { el.classList.add('cut', 's2'); this.shake = 22 }, T.cut),
      window.setTimeout(() => el.classList.add('fade'), T.titleFade),
      window.setTimeout(() => {
        el.className = ''
        for (const s of this.shakeEls) s.style.transform = ''
      }, T.end),
    ]
  }

  private newSpeck(w: number, h: number, anywhere: boolean): Speck {
    const dir = Math.random() < 0.5 ? 1 : -1
    // Chaos = VARIETY. Most specks small & fast, a few big & slow, all different.
    const big = Math.random() < 0.12
    const speed = big ? rand(120, 400) : rand(300, 1400)
    return {
      x: anywhere ? Math.random() * w : dir > 0 ? -30 : w + 30,
      y: Math.random() * h,
      vx: dir * speed,
      vy: rand(-180, 180),                 // drift up/down too, not just flat lines
      size: big ? rand(3, 7) : rand(0.6, 2.5),
      a: big ? rand(0.25, 0.6) : rand(0.3, 1),
      color: REDS[(Math.random() * REDS.length) | 0],
      front: Math.random() < 0.4,
      streak: !big && Math.random() < 0.7, // fast ones streak, big ones are blobs
      wobble: rand(0, 60),
      phase: rand(0, Math.PI * 2),
    }
  }

  private spawnSlash(now: number, w: number, h: number, power: number) {
    // power 1 = huge, thick, fast;  power 0 = small, thin, slow
    const cx = Math.random() * w, cy = Math.random() * h
    const ang = Math.random() * Math.PI
    const len = (0.25 + 0.9 * power) * Math.hypot(w, h) * rand(0.7, 1.1)
    const ux = Math.cos(ang), uy = Math.sin(ang)   // along the slash
    const nx = -uy, ny = ux                         // perpendicular to it
    // JAGGED: instead of a straight line, a zig-zag of ~10 points pushed sideways at random
    const segs = 10
    const jag = 4 + 14 * power
    const pts = []
    for (let i = 0; i <= segs; i++) {
      const along = (i / segs - 0.5) * len
      const side = i === 0 || i === segs ? 0 : rand(-jag, jag)
      pts.push({ x: cx + ux * along + nx * side, y: cy + uy * along + ny * side })
    }
    this.slashes.push({
      pts,
      born: now,
      life: 160 + (1 - power) * 450,      // weak slashes take longer = feel slower
      w: (3 + 11 * power) * rand(0.7, 1.2), // thick at peak, thin at the end
    })
    this.shake = Math.max(this.shake, 4 + 20 * power) // each slash kicks the camera
  }

  render(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, mask: HTMLCanvasElement | null, dtMs: number) {
    const now = performance.now()
    const t = now - this.started
    const { width: w, height: h } = ctx.canvas
    ctx.clearRect(0, 0, w, h)
    if (!this.active) return

    const I = this.intensity(t)
    const fxAmt = clamp01((t - T.fx) / T.dissolve)
    const endFade = clamp01((T.end - t) / T.fadeOut)
    ctx.globalAlpha = endFade

    this.applyShake(dtMs, I)

    // ---- 1. Room dissolves into black ----
    if (fxAmt > 0) {
      const px = this.disImg.data, n = this.noise
      const threshold = fxAmt * 1.6 - 0.4
      for (let i = 0; i < n.length; i++) {
        const v = (threshold - n[i]) * 8
        const j = i * 4
        if (v >= 1) { px[j] = px[j + 1] = px[j + 2] = 0; px[j + 3] = 255 }
        else if (v > 0) { px[j] = 140 * v; px[j + 1] = 0; px[j + 2] = 0; px[j + 3] = 255 * v }
        else px[j + 3] = 0
      }
      this.disCtx.putImageData(this.disImg, 0, 0)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(this.dis, -10, -10, w + 20, h + 20)
    }

    // speck speed follows intensity too (chaos calms down at the end)
    const speckDt = dtMs * (0.35 + 0.65 * I)
    this.drawSpecks(ctx, w, h, speckDt, now, false, fxAmt * endFade)
    if (fxAmt > 0 && mask) this.drawBody(ctx, video, mask, w, h, fxAmt * endFade)
    this.drawSpecks(ctx, w, h, speckDt, now, true, fxAmt * endFade)

    // ---- 6. slashes: frequent + huge at peak, rare + small at the end ----
    if (I > 0.03 && now > this.nextSlash) {
      const burst = Math.random() < 0.25 * I ? 3 : 1
      for (let i = 0; i < burst; i++) this.spawnSlash(now, w, h, I)
      this.nextSlash = now + 60 + (1 - I) * 500 + Math.random() * 150
    }
    this.drawSlashes(ctx, now, endFade)

    ctx.globalAlpha = 1
  }

  /** Shake the WHOLE screen (video, effects, title) — not just the canvas. */
  private applyShake(dtMs: number, I: number) {
    // decay: fast when intense (sharp jolts), slow when calm (soft sway)
    const decay = 0.78 + 0.17 * (1 - I)
    this.shake *= Math.pow(decay, dtMs / 16)
    const base = 2.5 * I // constant low-level jitter during the chaos
    const amp = this.shake + base
    this.shakeT += dtMs / 1000

    // ROUGH shake = new random offset every frame (jittery, violent)
    const rx = (Math.random() - 0.5) * 2, ry = (Math.random() - 0.5) * 2
    // SMOOTH shake = slow sine waves (floaty sway)
    const sx = Math.sin(this.shakeT * 17) * 0.7 + Math.sin(this.shakeT * 29) * 0.3
    const sy = Math.cos(this.shakeT * 13) * 0.7 + Math.sin(this.shakeT * 23) * 0.3
    // blend: rough at high intensity, smooth as it dies out
    const x = (rx * I + sx * (1 - I)) * amp
    const y = (ry * I + sy * (1 - I)) * amp
    const rot = (Math.random() - 0.5) * 0.6 * I * (amp / 10) // tiny rotation on big hits

    for (const el of this.shakeEls) el.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`
  }

  private drawSpecks(
    ctx: CanvasRenderingContext2D, w: number, h: number, dtMs: number, now: number, front: boolean, amt: number,
  ) {
    if (amt <= 0) return
    const dt = dtMs / 1000
    for (let i = 0; i < this.specks.length; i++) {
      const s = this.specks[i]
      if (s.front !== front) continue
      s.x += s.vx * dt
      s.y += s.vy * dt + Math.sin(now / 90 + s.phase) * s.wobble * dt // zig-zag
      // random kicks: every so often a speck lurches in a new vertical direction
      if (Math.random() < 0.02) s.vy = rand(-250, 250)
      if (s.x < -40 || s.x > w + 40 || s.y < -40 || s.y > h + 40) {
        this.specks[i] = this.newSpeck(w, h, false)
        continue
      }
      ctx.globalAlpha = s.a * amt * (0.7 + Math.random() * 0.3) // slight flicker
      ctx.fillStyle = s.color
      if (s.streak) {
        // streak points along the actual motion direction (including the vertical drift)
        const len = Math.hypot(s.vx, s.vy) * 0.018
        const ang = Math.atan2(s.vy, s.vx)
        ctx.save()
        ctx.translate(s.x, s.y)
        ctx.rotate(ang)
        ctx.fillRect(-len, -s.size / 2, len, s.size)
        ctx.restore()
      } else {
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
  }

  private drawBody(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, mask: HTMLCanvasElement, w: number, h: number, amt: number) {
    for (const c of [this.glow, this.body, this.edge]) if (c.width !== w) { c.width = w; c.height = h }
    const g = this.glow.getContext('2d')!, b = this.body.getContext('2d')!, e = this.edge.getContext('2d')!

    // GLOW RIM: blurred mask recoloured white, drawn behind the body -> halo
    g.clearRect(0, 0, w, h)
    g.filter = 'blur(7px)'
    g.drawImage(mask, 0, 0, w, h)
    g.filter = 'none'
    g.globalCompositeOperation = 'source-in'
    g.fillStyle = '#fff'
    g.fillRect(0, 0, w, h)
    g.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = amt * (0.75 + Math.random() * 0.25)
    ctx.drawImage(this.glow, 0, 0)
    ctx.drawImage(this.glow, 0, 0)

    // BODY: dark grey webcam cut to your shape
    b.clearRect(0, 0, w, h)
    b.filter = 'grayscale(1) contrast(2) brightness(0.2)'
    b.drawImage(video, 0, 0, w, h)
    b.filter = 'none'
    b.globalCompositeOperation = 'destination-in'
    b.drawImage(mask, 0, 0, w, h)

    // black gradient on the body's edges so you melt into the void
    e.globalCompositeOperation = 'source-over'
    e.fillStyle = '#000'
    e.fillRect(0, 0, w, h)
    e.globalCompositeOperation = 'destination-out'
    e.filter = 'blur(24px)'
    e.drawImage(mask, 0, 0, w, h)
    e.filter = 'none'
    b.globalCompositeOperation = 'source-atop'
    b.drawImage(this.edge, 0, 0)
    b.drawImage(this.edge, 0, 0)
    b.globalCompositeOperation = 'source-over'

    ctx.globalAlpha = amt
    ctx.drawImage(this.body, 0, 0)
    ctx.globalAlpha = 1
  }

  private drawSlashes(ctx: CanvasRenderingContext2D, now: number, fade: number) {
    ctx.lineCap = 'round'
    ctx.lineJoin = 'miter' // sharp corners on the zig-zag
    this.slashes = this.slashes.filter((s) => now - s.born < s.life)
    for (const s of this.slashes) {
      const p = (now - s.born) / s.life
      // head races along in the first 40%, then the tail catches up
      const head = clamp01(p / 0.4), tail = clamp01((p - 0.35) / 0.65)
      const n = s.pts.length - 1
      const i0 = Math.floor(tail * n), i1 = Math.ceil(head * n)
      if (i1 <= i0) continue
      ctx.beginPath()
      ctx.moveTo(s.pts[i0].x, s.pts[i0].y)
      for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(s.pts[i].x, s.pts[i].y)

      // 2 passes: dark-red wide glow underneath, white core on top
      const width = s.w * (1 - p * 0.5)
      ctx.globalAlpha = (1 - tail * 0.6) * fade
      ctx.shadowColor = '#b00000'
      ctx.shadowBlur = 18
      ctx.strokeStyle = '#7a0000'
      ctx.lineWidth = width * 2.2
      ctx.stroke()
      ctx.shadowBlur = 0
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = width
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }
}
