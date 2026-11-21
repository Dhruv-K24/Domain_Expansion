// k-Nearest Neighbours: the simplest "machine learning" there is. No training step at all.
//
// You record examples: [129 numbers] -> "Infinite Void".
// To classify a new pose, measure its distance to EVERY saved example, take the k closest,
// and let them vote. Most votes wins.
//
// It's perfect for a potato laptop: a few thousand examples x 129 numbers is tiny,
// and "adding training data" is just pushing to an array.
//
// One extra rule: if even the closest examples are far away, the pose isn't like ANY sign
// you recorded -> answer "none". Without this, kNN always picks *something*.

export type Sample = { label: string; f: number[]; rec?: number } // rec = which recording it came from
export type Prediction = { label: string; confidence: number; distance: number }

function rawDistance(a: number[], b: number[]) {
  let s = 0
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d }
  return Math.sqrt(s)
}

// CROSSING HANDS: features list "hand A" = the hand further LEFT on screen, then hand B.
// In interlocked signs your hands cross, so which one is "left" can flip mid-sign, and
// the same pose suddenly looks like a totally different list of numbers.
// Fix: also try the pose with A and B swapped, and keep whichever matches better.
// This is called making the model INVARIANT to something (here: hand order).
// Layout: [handA 0..62][handB 63..125][gapX, gapY 126,127][handCount 128]
function swapHands(f: number[]): number[] {
  return [...f.slice(63, 126), ...f.slice(0, 63), -f[126], -f[127], f[128]]
}

function distance(a: number[], aSwapped: number[] | null, b: number[]) {
  const d = rawDistance(a, b)
  return aSwapped ? Math.min(d, rawDistance(aSwapped, b)) : d
}

export function classify(samples: Sample[], f: number[], k = 7, maxDistance = 4): Prediction {
  if (samples.length === 0) return { label: 'none', confidence: 0, distance: Infinity }

  const swapped = f.length === 129 && f[128] === 2 ? swapHands(f) : null // only for 2-hand poses
  const nearest = samples
    .map((s) => ({ label: s.label, d: distance(f, swapped, s.f) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k)

  // CLASS BALANCING: if "none" has 10x more samples than a sign, it naturally shows up more
  // often among the nearest neighbours just by being everywhere. So each vote is weighted by
  // 1/sqrt(how many samples that label has). sqrt = a middle ground between no correction
  // and full 1/count correction (full correction over-boosts tiny classes).
  const counts = classCounts(samples)
  const votes = new Map<string, number>()
  let totalWeight = 0
  for (const n of nearest) {
    const wgt = 1 / Math.sqrt(counts.get(n.label) ?? 1)
    votes.set(n.label, (votes.get(n.label) ?? 0) + wgt)
    totalWeight += wgt
  }
  const [label, weight] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]
  const closest = nearest[0].d

  if (closest > maxDistance) return { label: 'none', confidence: 0, distance: closest }
  return { label, confidence: weight / totalWeight, distance: closest }
}

// counting labels on every call would be wasteful, so remember the result per dataset size
let countsCache: { arr: Sample[]; len: number; counts: Map<string, number> } | null = null
function classCounts(samples: Sample[]) {
  if (countsCache && countsCache.arr === samples && countsCache.len === samples.length) return countsCache.counts
  const counts = new Map<string, number>()
  for (const s of samples) counts.set(s.label, (counts.get(s.label) ?? 0) + 1)
  countsCache = { arr: samples, len: samples.length, counts }
  return counts
}
