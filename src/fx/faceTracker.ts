// FaceTracker — 478 points on your face, from MediaPipe's Face Landmarker model.
//
// We only need two groups of points:
//   FACE_OVAL: the outline of your face (to black it out)
//   mouth:     corners (61, 291) + inner lips (13 top, 14 bottom) -> where the grin goes,
//              how wide, how tilted, and how open your mouth is.
// The numbers are fixed indices in MediaPipe's face mesh (it always numbers points the same way).
//
// Like the body segmenter, it only runs while a domain that needs it is active.

import { FilesetResolver, FaceLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'

const MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

// face outline, in order around the face (from MediaPipe's FACE_OVAL connections)
export const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
  148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
]

export type Face = NormalizedLandmark[]

export class FaceTracker {
  private lm: FaceLandmarker | null = null
  face: Face | null = null
  private lastSeen = 0

  async load(delegate: 'GPU' | 'CPU') {
    const vision = await FilesetResolver.forVisionTasks('/mediapipe-wasm')
    this.lm = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
    })
  }

  get ready() {
    return this.lm !== null
  }

  update(video: HTMLVideoElement, now: number) {
    if (!this.lm) return
    const res = this.lm.detectForVideo(video, now)
    if (res.faceLandmarks.length) {
      this.face = res.faceLandmarks[0]
      this.lastSeen = now
    } else if (now - this.lastSeen > 300) {
      this.face = null // keep the last face briefly (blinks / quick turns), then let go
    }
  }

  clear() {
    this.face = null
  }
}
