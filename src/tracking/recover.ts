// Recovery: "look around where the hand used to be" — your idea, done properly.
//
// Why MediaPipe loses fast hands: when tracking breaks, it scans the WHOLE 640x480 frame
// for a palm. The model shrinks that frame to a small input (~192px), so a blurry, fast hand
// becomes a tiny smudge and the palm detector misses it for several frames.
//
// Fix: cut out a square around our PREDICTED position, blow it up to 256x256, and run a
// second detector on just that. Now the hand fills the picture -> much easier to find.
// It only runs while a hand is lost, so it costs nothing while tracking is fine.

import { HandLandmarker, type NormalizedLandmark, type Category } from '@mediapipe/tasks-vision'

const CROP_PX = 256
const crop = document.createElement('canvas')
crop.width = crop.height = CROP_PX
const cctx = crop.getContext('2d', { willReadFrequently: true })!

export type Recovered = { landmarks: NormalizedLandmark[]; handedness: Category[] }

export function recoverHand(
  imageDetector: HandLandmarker,
  video: HTMLVideoElement,
  center: { x: number; y: number }, // predicted palm centre, 0..1
  handSize: number,                 // wrist->knuckle length, 0..1 of width
  searchScale: number,              // how many hand-sizes wide the search box is
): Recovered | null {
  const W = video.videoWidth, H = video.videoHeight
  // square box (in pixels) around the prediction
  const side = Math.min(Math.max(handSize * W * searchScale, 160), Math.min(W, H))
  const sx = Math.min(Math.max(center.x * W - side / 2, 0), W - side)
  const sy = Math.min(Math.max(center.y * H - side / 2, 0), H - side)

  cctx.drawImage(video, sx, sy, side, side, 0, 0, CROP_PX, CROP_PX)
  const res = imageDetector.detect(crop)
  if (!res.landmarks.length) return null

  // map crop coords (0..1 of the crop) back to full-frame coords (0..1 of the video)
  const landmarks = res.landmarks[0].map((p) => ({
    x: (sx + p.x * side) / W,
    y: (sy + p.y * side) / H,
    z: p.z,
    visibility: p.visibility,
  }))
  return { landmarks, handedness: res.handedness[0] }
}
