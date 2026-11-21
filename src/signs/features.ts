// Features: turning "hands on screen" into a list of numbers that describes the SIGN,
// not where you happen to stand.
//
// Raw landmarks change if you step left, lean in, or sit further back — but the sign is the same.
// So we normalise:
//   - position: every point is measured FROM ITS OWN WRIST   (moving around doesn't matter)
//   - scale:    divided by hand size (wrist -> middle knuckle) (distance to camera doesn't matter)
// We keep rotation, because in hand signs the angle of the hands IS part of the sign.
// Two-hand signs also need "where is hand B relative to hand A", so we add that too.

import type { TrackedHand } from '../tracking/handTracker'

const PALM = [0, 5, 9, 13, 17]
const palmCenter = (h: TrackedHand) => {
  let x = 0, y = 0
  for (const i of PALM) { x += h.points[i].x; y += h.points[i].y }
  return { x: x / PALM.length, y: y / PALM.length }
}
const size = (h: TrackedHand) =>
  Math.hypot(h.points[0].x - h.points[9].x, h.points[0].y - h.points[9].y) || 0.1

function oneHand(h: TrackedHand | undefined): number[] {
  if (!h) return new Array(21 * 3).fill(0)
  const w = h.points[0], s = size(h)
  return h.points.flatMap((p) => [(p.x - w.x) / s, (p.y - w.y) / s, ((p.z - w.z) / s) * 0.5])
}

// 63 numbers per hand x2, + 2 for the gap between hands, + 1 "how many hands" = 129 numbers
export function signFeatures(hands: TrackedHand[]): number[] | null {
  if (hands.length === 0) return null
  // Order by screen position (not the flickery Left/Right label) so "hand A" is always the same one.
  const sorted = [...hands].sort((a, b) => palmCenter(a).x - palmCenter(b).x)
  const [a, b] = sorted
  let gap = [0, 0]
  if (b) {
    const ca = palmCenter(a), cb = palmCenter(b), s = (size(a) + size(b)) / 2
    gap = [(cb.x - ca.x) / s, (cb.y - ca.y) / s]
  }
  return [...oneHand(a), ...oneHand(b), ...gap, b ? 2 : 0]
}
