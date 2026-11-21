// Body segmentation: "which pixels are YOU and which are the room?"
//
// MediaPipe's selfie segmenter is a small neural net that outputs a CONFIDENCE MASK:
// one number per pixel from 0 (background) to 1 (person). We turn that into a canvas
// whose alpha channel = that number, so we can use it like a stencil:
//   "draw this effect, but only where the person is" (or only where they're NOT).
//
// It only runs while a domain is active, so normal play doesn't pay for it.

import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision'

const MODEL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'

export class BodyMask {
  canvas = document.createElement('canvas')
  private ctx = this.canvas.getContext('2d')!
  private seg: ImageSegmenter | null = null
  private img: ImageData | null = null
  ready = false

  async load(delegate: 'GPU' | 'CPU') {
    const vision = await FilesetResolver.forVisionTasks('/mediapipe-wasm')
    this.seg = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    })
  }

  /** Update the mask from the current video frame. */
  update(video: HTMLVideoElement, now: number) {
    if (!this.seg) return
    // Callback style: the mask data is only valid INSIDE the callback (it lives on the GPU),
    // so we copy it into our own ImageData right there.
    this.seg.segmentForVideo(video, now, (result) => {
      const mask = result.confidenceMasks?.[0]
      if (!mask) return
      const { width, height } = mask
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width
        this.canvas.height = height
        this.img = this.ctx.createImageData(width, height)
      }
      const conf = mask.getAsFloat32Array()
      const px = this.img!.data
      for (let i = 0; i < conf.length; i++) {
        // sharpen the edge a bit: 0.3..0.7 confidence stretched to 0..1
        const a = Math.min(1, Math.max(0, (conf[i] - 0.3) / 0.4))
        const j = i * 4
        px[j] = px[j + 1] = px[j + 2] = 255
        px[j + 3] = a * 255
      }
      this.ctx.putImageData(this.img!, 0, 0)
      this.ready = true
    })
  }
}
