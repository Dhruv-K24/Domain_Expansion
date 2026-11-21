// ScreenShake — shakes whole page elements (video, effects, titles) with CSS transforms.
//
// Two flavours, blended by `roughness`:
//   rough  (1): a new random offset every frame -> violent jitter
//   smooth (0): slow overlapping sine waves     -> floaty sway
// `kick(px)` adds a jolt that decays over time (each slash, a burst, etc.).

export class ScreenShake {
  private amp = 0
  private time = 0
  /** camera zoom (1 = normal). Lives here because shake + zoom share ONE CSS transform. */
  zoom = 1
  private els: HTMLElement[]

  constructor(...ids: string[]) {
    this.els = ids.map((id) => document.getElementById(id)!).filter(Boolean)
  }

  /** add a jolt (keeps the stronger of the current and the new one) */
  kick(px: number) {
    this.amp = Math.max(this.amp, px)
  }

  /**
   * Call once per frame.
   * @param base constant background jitter in px
   * @param roughness 0 = smooth sway .. 1 = rough jitter
   * @param decay how much of the jolt survives per 16ms (0.78 = snappy, 0.95 = slow fade)
   */
  update(dtMs: number, base: number, roughness: number, decay = 0.85) {
    this.amp *= Math.pow(decay, dtMs / 16)
    this.time += dtMs / 1000
    const a = this.amp + base
    const t = this.time
    const rx = (Math.random() - 0.5) * 2, ry = (Math.random() - 0.5) * 2
    const sx = Math.sin(t * 17) * 0.7 + Math.sin(t * 29) * 0.3
    const sy = Math.cos(t * 13) * 0.7 + Math.sin(t * 23) * 0.3
    const x = (rx * roughness + sx * (1 - roughness)) * a
    const y = (ry * roughness + sy * (1 - roughness)) * a
    const rot = (Math.random() - 0.5) * 0.6 * roughness * (a / 10)
    for (const el of this.els) el.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg) scale(${this.zoom})`
  }

  reset() {
    this.amp = 0
    this.zoom = 1
    for (const el of this.els) el.style.transform = ''
  }
}
