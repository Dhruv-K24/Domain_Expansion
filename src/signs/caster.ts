// Caster: turns the classifier's frame-by-frame guesses into ONE decision.
//
// The classifier answers every frame, and single frames are noisy ("Malevolent Shrine!" for
// 1 frame while you move your hands). So it's a small STATE MACHINE:
//   IDLE   -> sees a sign confidently -> CHARGING (bar fills while you hold it)
//   CHARGING -> held long enough -> CAST (fire the domain!) -> COOLDOWN -> IDLE
//   CHARGING -> sign changes / lost -> bar drains back down
import type { Prediction } from './knn'

export const CAST = {
  minConfidence: 0.6, // share of neighbour votes needed
  holdMs: 1500,       // how long to hold the sign
  cooldownMs: 5000,   // how long the domain lasts before you can cast again
}

export type CastState = { phase: 'idle' | 'charging' | 'cast'; label: string; progress: number }

export class Caster {
  private label = 'none'
  private progress = 0 // 0..1
  private castUntil = 0
  private last = performance.now()

  private armed = true // false right after a cast, until you let go of the sign

  update(p: Prediction, now: number): CastState {
    // Cap the time step: if updates paused (e.g. during the domain), the first update after
    // must not count the whole pause as "holding" — that instantly re-cast the domain.
    const dt = Math.min(now - this.last, 100)
    this.last = now

    if (now < this.castUntil) return { phase: 'cast', label: this.label, progress: 1 }

    const good = p.label !== 'none' && p.confidence >= CAST.minConfidence
    // Must release the sign after a cast before it can charge again (no accidental double cast).
    if (!this.armed) {
      if (!good) this.armed = true
      return { phase: 'idle', label: this.label, progress: 0 }
    }
    if (good && p.label === this.label) {
      this.progress += dt / CAST.holdMs // keep holding -> fill
    } else if (good && this.progress <= 0) {
      this.label = p.label // new sign starts charging
    } else {
      this.progress -= (dt / CAST.holdMs) * 1.5 // wrong/lost -> drain (a brief glitch won't reset it)
    }
    this.progress = Math.max(0, Math.min(1, this.progress))

    if (this.progress >= 1) {
      this.castUntil = now + CAST.cooldownMs
      this.progress = 0
      this.armed = false
      return { phase: 'cast', label: this.label, progress: 1 }
    }
    return { phase: this.progress > 0 ? 'charging' : 'idle', label: this.label, progress: this.progress }
  }
}
