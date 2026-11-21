// HandTracker — sits between MediaPipe's raw output and the game.
//
// MediaPipe gives us a fresh, independent guess every frame. It has no idea that
// "the hand at (0.4, 0.5) now" is the same hand as "the hand at (0.38, 0.5) a moment ago".
// This file adds that idea: each real hand becomes a TRACK with an id and a memory.
//
// It fixes four problems:
//  1. Jitter       -> each of the 21x3 coordinates goes through a One Euro filter.
//  2. Ghost hands  -> two detections sitting on top of each other = one hand. Drop the weaker one.
//  3. Colour flips -> we match detections to tracks by POSITION, not by MediaPipe's Left/Right
//                     label (which flickers). The label is decided by a vote over many frames.
//  4. Losing track -> when a hand vanishes we don't delete it right away. We "coast":
//                     keep moving it along its last velocity for a short time. If MediaPipe
//                     finds a hand near there again, it re-joins the same track (same id/colour).

import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { OneEuroFilter } from './oneEuro'

// same shape MediaPipe uses, so we can hand our smoothed points straight to its drawing helpers
export type Point = NormalizedLandmark

export type TrackedHand = {
  id: number
  label: 'Left' | 'Right'
  points: Point[]      // 21 smoothed landmarks
  coasting: boolean    // true = MediaPipe can't see it right now, this is our prediction
  confidence: number   // 1 = seen this frame, fades toward 0 while coasting
}

// ---- Tunable knobs (play with these!) ----
export const TUNING = {
  coastMs: 700,          // how long to "remember" a lost hand
  coastDamping: 0.92,    // predicted motion slows down each frame (so it doesn't fly off)
  matchDistance: 4,      // how far (in hand-sizes) a detection can be from a track and still match
  searchScale: 7,        // recovery search box width, in hand-sizes (grows the longer it's lost)
  duplicateDistance: 0.35, // two hands closer than this (in hand-sizes) = duplicate
  labelVotes: 8,         // how many frames of agreement before the Left/Right label switches
  minCutoff: 1.0,        // One Euro: smoothness when still
  beta: 10,              // One Euro: responsiveness when moving
}

type Track = {
  id: number
  filters: OneEuroFilter[]     // 63 filters: x,y,z for each of 21 points
  points: Point[]
  lastSeen: number
  lastUpdate: number
  labelScore: number           // >0 leans Right, <0 leans Left
  label: 'Left' | 'Right'
}

type Candidate = { points: Point[]; label: 'Left' | 'Right'; score: number; center: Point; size: number }

let nextId = 1

function center(pts: Point[]): Point {
  // average of wrist (0) and the 4 finger knuckles (5, 9, 13, 17) = palm centre. Stable, unlike fingertips.
  const idx = [0, 5, 9, 13, 17]
  const c = { x: 0, y: 0, z: 0, visibility: 1 }
  for (const i of idx) { c.x += pts[i].x; c.y += pts[i].y; c.z += pts[i].z }
  return { x: c.x / idx.length, y: c.y / idx.length, z: c.z / idx.length, visibility: 1 }
}

function handSize(pts: Point[]) {
  // wrist -> middle knuckle distance. Shrinks/grows as hand moves toward/away from camera,
  // so using it as a unit makes our distance thresholds work at any distance.
  return Math.hypot(pts[0].x - pts[9].x, pts[0].y - pts[9].y) || 0.1
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

export class HandTracker {
  private tracks: Track[] = []

  update(
    landmarks: NormalizedLandmark[][],
    handedness: { categoryName: string; score: number }[][],
    now: number,
  ): TrackedHand[] {
    // ---- 1. Turn raw output into candidates ----
    let cands: Candidate[] = landmarks.map((pts, i) => ({
      points: pts.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility })),
      label: (handedness[i]?.[0]?.categoryName as 'Left' | 'Right') ?? 'Right',
      score: handedness[i]?.[0]?.score ?? 0.5,
      center: center(pts),
      size: handSize(pts),
    }))

    // ---- 2. Remove duplicates (the "one hand shown as two" bug) ----
    cands.sort((a, b) => b.score - a.score)
    cands = cands.filter((c, i) =>
      !cands.slice(0, i).some((better) =>
        dist(c.center, better.center) < TUNING.duplicateDistance * Math.max(c.size, better.size)))

    // ---- 3. Match candidates to existing tracks (closest first) ----
    const pairs: { t: Track; c: Candidate; d: number }[] = []
    for (const t of this.tracks) {
      const tc = center(t.points)
      for (const c of cands) {
        const d = dist(tc, c.center) / c.size
        if (d < TUNING.matchDistance) pairs.push({ t, c, d })
      }
    }
    pairs.sort((a, b) => a.d - b.d)
    const usedT = new Set<Track>(), usedC = new Set<Candidate>()
    for (const { t, c } of pairs) {
      if (usedT.has(t) || usedC.has(c)) continue
      usedT.add(t); usedC.add(c)
      this.applyDetection(t, c, now)
    }

    // ---- 4. Leftover candidates become new tracks ----
    for (const c of cands) {
      if (usedC.has(c) || this.tracks.length >= 2) continue
      const t: Track = {
        id: nextId++,
        filters: Array.from({ length: 63 }, () => new OneEuroFilter(TUNING.minCutoff, TUNING.beta)),
        points: c.points,
        lastSeen: now,
        lastUpdate: now,
        labelScore: c.label === 'Right' ? TUNING.labelVotes : -TUNING.labelVotes,
        label: c.label,
      }
      this.applyDetection(t, c, now)
      this.tracks.push(t)
      usedT.add(t)
    }

    // ---- 5. Unseen tracks: coast (predict) or forget ----
    for (const t of this.tracks) {
      if (usedT.has(t)) continue
      t.lastUpdate = now
      // Move the hand as ONE RIGID SHAPE using the palm's speed.
      // (Moving each point by its own speed made fingers stretch/explode, because one jittery
      //  fingertip could have a crazy speed. The palm speed is stable; the finger pose is kept.)
      const palm = [0, 5, 9, 13, 17]
      let vx = 0, vy = 0
      for (const i of palm) { vx += t.filters[i * 3].velocity; vy += t.filters[i * 3 + 1].velocity }
      vx /= palm.length; vy /= palm.length
      t.points = t.points.map((p, i) => ({
        x: t.filters[i * 3].coast(now, TUNING.coastDamping, vx),
        y: t.filters[i * 3 + 1].coast(now, TUNING.coastDamping, vy),
        z: p.z,
        visibility: p.visibility,
      }))
    }
    this.tracks = this.tracks.filter((t) => now - t.lastSeen < TUNING.coastMs)

    return this.tracks.map((t) => {
      const missing = now - t.lastSeen
      return {
        id: t.id,
        label: t.label,
        points: t.points,
        coasting: missing > 0,
        confidence: missing > 0 ? 1 - missing / TUNING.coastMs : 1,
      }
    })
  }

  /** Lost hands that have no fresh detection nearby -> where should recovery look? */
  lostHands(freshLandmarks: NormalizedLandmark[][], now: number) {
    return this.tracks
      .filter((t) => t.lastSeen < t.lastUpdate) // last update was a coast = currently lost
      .map((t) => {
        const c = center(t.points), size = handSize(t.points)
        const lostFor = now - t.lastSeen
        return { id: t.id, center: c, size, searchScale: TUNING.searchScale * (1 + lostFor / 400) }
      })
      .filter((l) => !freshLandmarks.some((pts) => dist(center(pts), l.center) < TUNING.matchDistance * l.size))
  }

  private applyDetection(t: Track, c: Candidate, now: number) {
    // When a hand comes back after coasting, our filters still hold the old position.
    // If it jumped far, reset the filters so it snaps instead of sliding across the screen.
    const jumped = dist(center(t.points), c.center) > c.size * 1.5
    if (jumped) t.filters.forEach((f) => f.reset())

    t.points = c.points.map((p, i) => ({
      x: t.filters[i * 3].filter(p.x, now),
      y: t.filters[i * 3 + 1].filter(p.y, now),
      z: t.filters[i * 3 + 2].filter(p.z, now),
      visibility: p.visibility,
    }))
    t.lastSeen = now
    t.lastUpdate = now

    // Label voting: each frame nudges the score; the label only flips after sustained agreement.
    t.labelScore += c.label === 'Right' ? 1 : -1
    t.labelScore = Math.max(-TUNING.labelVotes, Math.min(TUNING.labelVotes, t.labelScore))
    if (t.labelScore >= TUNING.labelVotes) t.label = 'Right'
    if (t.labelScore <= -TUNING.labelVotes) t.label = 'Left'
  }
}
