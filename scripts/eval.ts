// Model report card:  npm run eval
//
// "It seems to work" isn't a measurement. This script MEASURES how good the classifier is.
//
// The trap (very common, even for pros): if you test a sample against all the OTHER samples,
// the frame recorded 1/30th of a second earlier is almost identical, so you get ~100% and learn
// nothing. That's called DATA LEAKAGE. Real use = classifying a pose from a moment you never
// recorded. So we hold out a WHOLE RECORDING at a time and test it against the rest.
// This is "leave-one-group-out cross-validation".
//
// Output: accuracy per sign + a CONFUSION MATRIX (rows = what you actually did,
// columns = what the model said). Big numbers off the diagonal = signs it mixes up.

import fs from 'node:fs'
import { classify, type Sample } from '../src/signs/knn.ts'

const data: Sample[] = JSON.parse(fs.readFileSync('data/signs.json', 'utf8'))

// Group samples into recordings. New samples carry a `rec` id; older ones don't, so for those
// we cut each unbroken run of the same label into chunks of ~60 frames (about one 3s recording).
// (If we held out a whole run, a sign recorded in one sitting would vanish from training
//  entirely and could never be predicted — a broken test, not a bad model.)
const CHUNK = 60
const groups: Sample[][] = []
let lastKey = ''
for (const s of data) {
  const key = s.rec !== undefined ? `rec:${s.rec}` : `run:${s.label}`
  const cur = groups[groups.length - 1]
  if (key !== lastKey || !cur || (s.rec === undefined && cur.length >= CHUNK)) groups.push([])
  groups[groups.length - 1].push(s)
  lastKey = key
}

const labels = [...new Set(data.map((s) => s.label))].sort()
const cols = [...labels]
if (!cols.includes('none')) cols.push('none')
const matrix: Record<string, Record<string, number>> = {}
for (const a of labels) { matrix[a] = {}; for (const b of cols) matrix[a][b] = 0 }

console.log(`${data.length} samples, ${groups.length} recordings, signs: ${labels.join(', ')}\n`)
if (groups.length < 2) { console.log('Need at least 2 recordings to test.'); process.exit(0) }

const STEP = 3 // test every 3rd frame (neighbouring frames are near-identical anyway; 3x faster)
for (const g of groups) {
  const train = data.filter((s) => !g.includes(s))
  for (let i = 0; i < g.length; i += STEP) {
    const p = classify(train, g[i].f)
    matrix[g[i].label][p.label]++
  }
}

const pad = (s: string | number, n: number) => String(s).slice(0, n).padStart(n)
console.log('CONFUSION MATRIX  (rows = truth, columns = prediction)')
console.log(pad('', 18) + cols.map((c) => pad(c, 12)).join(''))
let correct = 0, total = 0
for (const a of labels) {
  const row = matrix[a]
  const n = Object.values(row).reduce((x, y) => x + y, 0)
  correct += row[a]; total += n
  console.log(pad(a, 18) + cols.map((c) => pad(row[c], 12)).join('') + `   ${((100 * row[a]) / n).toFixed(0)}% right`)
}
console.log(`\nOverall: ${((100 * correct) / total).toFixed(1)}% on recordings the model had never seen.`)
console.log('Tip: a sign with low % -> record it more, from more angles. Two signs confusing each other -> record both more.')
