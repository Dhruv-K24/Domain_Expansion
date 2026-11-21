// One Euro Filter — a smoothing filter made for exactly this problem (shaky tracking).
//
// The trade-off with any smoothing: more smoothing = less jitter but more lag.
// The One Euro trick: change the amount of smoothing based on SPEED.
//   - Hand still  -> smooth a lot   (kills jitter, lag doesn't matter when still)
//   - Hand moving -> smooth a little (follows fast motion, jitter isn't noticeable)
//
// Paper: Casiez et al. 2012, "1€ Filter". Used in lots of VR/AR hand tracking.

export class OneEuroFilter {
  private prevValue: number | null = null
  private prevDeriv = 0
  private prevTime = 0

  minCutoff: number // lower = smoother when still (but laggier)
  beta: number      // higher = less lag when moving fast
  dCutoff: number   // smoothing of the speed estimate itself

  constructor(minCutoff = 1.0, beta = 10, dCutoff = 1.0) {
    this.minCutoff = minCutoff
    this.beta = beta
    this.dCutoff = dCutoff
  }

  // alpha = how much of the NEW value to take (0..1), from a cutoff frequency in Hz.
  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff)
    return 1 / (1 + tau / dt)
  }

  filter(value: number, timeMs: number): number {
    if (this.prevValue === null) {
      this.prevValue = value
      this.prevTime = timeMs
      return value
    }
    const dt = Math.max((timeMs - this.prevTime) / 1000, 1e-3)
    this.prevTime = timeMs

    // 1) estimate speed (and smooth that estimate a bit)
    const rawDeriv = (value - this.prevValue) / dt
    const aD = this.alpha(this.dCutoff, dt)
    const deriv = aD * rawDeriv + (1 - aD) * this.prevDeriv
    this.prevDeriv = deriv

    // 2) faster movement -> higher cutoff -> less smoothing
    const cutoff = this.minCutoff + this.beta * Math.abs(deriv)
    const a = this.alpha(cutoff, dt)
    const out = a * value + (1 - a) * this.prevValue
    this.prevValue = out
    return out
  }

  /** current speed estimate (units per second) — we reuse it for predicting motion */
  get velocity() {
    return this.prevDeriv
  }

  /** No measurement this frame: predict by moving along the last speed, slowing down by `damping`. */
  coast(timeMs: number, damping: number, useVelocity?: number): number {
    if (this.prevValue === null) return 0
    const dt = Math.max((timeMs - this.prevTime) / 1000, 0)
    this.prevTime = timeMs
    this.prevDeriv = (useVelocity ?? this.prevDeriv) * damping
    this.prevValue += this.prevDeriv * dt
    return this.prevValue
  }

  reset() {
    this.prevValue = null
    this.prevDeriv = 0
  }
}
