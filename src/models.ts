// Every AI model the app downloads, in ONE place.
// The app loads them from here, and the build reads this same list to tell the service worker
// what to save for offline use — so the two can never get out of sync.
export const MODELS = {
  hands: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  body: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
  face: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
}
