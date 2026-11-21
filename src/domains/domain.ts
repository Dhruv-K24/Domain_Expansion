// Domain — the base every domain expansion builds on.
//
// This is INHERITANCE: `class MalevolentShrine extends Domain`. The base class handles the
// boring parts every domain needs the same way:
//   - the clock (start time, `active`, how far in we are)
//   - the end: fade-out amount, cleaning up the shake and title when it's over
//   - shared tools: BodyLayer (you, cut out), ScreenShake, DomainTitle
// and each domain only writes what makes it unique, in two methods:
//   onStart()  — set up particles / textures for this cast
//   draw()     — paint one frame
//
// main.ts doesn't need to know anything about specific domains anymore: it keeps a list
// and calls start()/render() — adding a domain = one new file + one line in that list.

import { BodyLayer } from '../fx/bodyLayer'
import { ScreenShake } from '../fx/screenShake'
import { DomainTitle, type TitleTiming } from '../fx/domainTitle'
import type { Face } from '../fx/faceTracker'
import { defaultPost, type PostSettings } from '../fx/postFX'

export type DomainInputs = {
  video: HTMLVideoElement
  mask: HTMLCanvasElement | null // your silhouette (null until the segmenter has a result)
  face: Face | null              // face landmarks (only tracked if the domain sets needsFace)
}

export type DomainConfig = {
  id: string          // matches the sign label in the dataset, e.g. 'malevolent_shrine'
  name: string        // shown in the title
  theme: string       // CSS theme class for the title
  duration: number    // ms
  fadeOut: number     // ms at the end where everything fades back to the room
  title: TitleTiming
  cutTitle?: boolean
  needsFace?: boolean
  post?: Partial<PostSettings> // GPU look: bloom, heat distortion, grading (see postFX.ts)
}

export abstract class Domain {
  readonly cfg: DomainConfig
  protected started = 0
  protected w = 640
  protected h = 480
  protected body = new BodyLayer()
  protected shake: ScreenShake
  protected title: DomainTitle
  private wasActive = false
  /** shader settings main.ts reads every frame; a domain may change them while it runs */
  post: PostSettings = defaultPost()

  constructor(cfg: DomainConfig) {
    this.cfg = cfg
    this.title = new DomainTitle(cfg.name, cfg.theme, cfg.title, cfg.cutTitle)
    this.shake = new ScreenShake('stage')
  }

  get id() { return this.cfg.id }
  get needsFace() { return !!this.cfg.needsFace }

  get active() {
    return this.started > 0 && performance.now() - this.started < this.cfg.duration
  }

  /** ms since the cast */
  protected get t() {
    return performance.now() - this.started
  }

  /** 1 normally, sliding to 0 during the last `fadeOut` ms */
  protected get endFade() {
    return Math.max(0, Math.min(1, (this.cfg.duration - this.t) / this.cfg.fadeOut))
  }

  start(w: number, h: number) {
    this.started = performance.now()
    this.w = w
    this.h = h
    this.wasActive = true
    this.post = { ...defaultPost(), ...this.cfg.post }
    this.title.play()
    this.onStart()
  }

  render(ctx: CanvasRenderingContext2D, inputs: DomainInputs, dtMs: number) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    if (!this.active) {
      if (this.wasActive) { this.wasActive = false; this.shake.reset(); this.onEnd() } // clean up once
      return
    }
    this.draw(ctx, inputs, this.t, dtMs)
    ctx.globalAlpha = 1
  }

  protected abstract onStart(): void
  protected abstract draw(ctx: CanvasRenderingContext2D, inputs: DomainInputs, t: number, dtMs: number): void
  protected onEnd(): void {}
}

// small math helpers every domain uses (re-exported so domains import everything from here)
export { clamp01, rand, easeOut } from '../util/math'
