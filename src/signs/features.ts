// Features: turning "hands on screen" into a list of numbers that describes the SIGN,
// not where you happen to stand.
//
// Raw landmarks change if you step left, lean in, or sit further back — but the sign is the same.
// So we normalise:
//   - position: every point is measured FROM ITS OWN WRIST   (moving around doesn't matter)
//   - scale:    divided by hand size (wrist -> middle knuckle) (distance to camera doesn't matter)
// We keep rotation, because in hand signs the angle of the hands IS part of the sign.
// Two-hand signs also need "where is hand B relative to hand A", so we add that too.
//
// ASPECT RATIO: landmark x/y are FRACTIONS of the image width/height (0..1). On a 4:3 laptop
// camera one unit of x is wider than one unit of y; on a PORTRAIT phone camera it's the other way
// round, so the same hand would come out squashed and stop matching the training data.
// So x (and z, which MediaPipe measures on the same scale as x) is converted into "4:3 laptop
// units": factor = (camera width/height) / (4/3). Laptop: factor 1, the recorded data stays
// valid. Portrait phone: the hand keeps its real shape.

import type { TrackedHand } from '../tracking/handTracker'

const TRAINED_ASPECT = 4 / 3 // the laptop camera the signs were recorded with (640x480)
const PALM = [0, 5, 9, 13, 17]

export function signFeatures(hands: TrackedHand[], aspect = TRAINED_ASPECT): number[] | null {
  if (hands.length === 0) return null
  const k = aspect / TRAINED_ASPECT
  const X = (h: TrackedHand, i: number) => h.points[i].x * k
  const Y = (h: TrackedHand, i: number) => h.points[i].y
  const palmCenter = (h: TrackedHand) => {
    let x = 0, y = 0
    for (const i of PALM) { x += X(h, i); y += Y(h, i) }
    return { x: x / PALM.length, y: y / PALM.length }
  }
  const size = (h: TrackedHand) => Math.hypot(X(h, 0) - X(h, 9), Y(h, 0) - Y(h, 9)) || 0.1
  const oneHand = (h: TrackedHand | undefined): number[] => {
    if (!h) return new Array(21 * 3).fill(0)
    const s = size(h), wx = X(h, 0), wy = Y(h, 0), wz = h.points[0].z
    return h.points.flatMap((p, i) => [(X(h, i) - wx) / s, (Y(h, i) - wy) / s, (((p.z - wz) * k) / s) * 0.5])
  }

  // Order by screen position (not the flickery Left/Right label) so "hand A" is always the same one.
  const sorted = [...hands].sort((a, b) => palmCenter(a).x - palmCenter(b).x)
  const [a, b] = sorted
  let gap = [0, 0]
  if (b) {
    const ca = palmCenter(a), cb = palmCenter(b), s = (size(a) + size(b)) / 2
    gap = [(cb.x - ca.x) / s, (cb.y - ca.y) / s]
  }
  // 63 numbers per hand x2, + 2 for the gap between hands, + 1 "how many hands" = 129 numbers
  return [...oneHand(a), ...oneHand(b), ...gap, b ? 2 : 0]
}
