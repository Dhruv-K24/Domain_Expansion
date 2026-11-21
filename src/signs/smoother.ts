// SignSmoother — stops the guess from flickering.
//
// The classifier judges every frame on its own, and single frames are noisy: a blurry frame or
// a finger in a weird spot can flip "Unlimited Void" to "none" for one frame, which drains the
// cast bar. So we keep a running SCORE per sign and blend each new guess in a little:
//
//     score = score * (1 - k) + newGuess * k      (k = 0.25)
//
// This is an EXPONENTIAL MOVING AVERAGE: recent frames count most, older ones fade out.
// One bad frame barely dents the score; a sign held for a few frames clearly wins.

import type { Prediction } from './knn'

export class SignSmoother {
  private scores = new Map<string, number>()
  private k: number

  constructor(k = 0.25) {
    this.k = k
  }

  update(p: Prediction): Prediction {
    // the guessed label gets its confidence, every other label decays toward 0
    const target = p.label === 'none' ? 0 : p.confidence
    for (const [label, s] of this.scores) this.scores.set(label, s * (1 - this.k) + (label === p.label ? target : 0) * this.k)
    if (!this.scores.has(p.label) && p.label !== 'none') this.scores.set(p.label, target * this.k)
    let best = 'none', bestScore = 0
    for (const [label, s] of this.scores) if (s > bestScore) { best = label; bestScore = s }
    return { label: bestScore > 0.15 ? best : 'none', confidence: bestScore, distance: p.distance }
  }
}
