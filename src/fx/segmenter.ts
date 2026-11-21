// Body segmentation: "which pixels are YOU and which are the room?"
//
// MediaPipe's selfie segmenter is a small neural net that outputs a CONFIDENCE MASK:
// one number per pixel from 0 (background) to 1 (person). We turn that into a canvas
// whose alpha channel = that number, so we can use it like a stencil:
//   "draw this effect, but only where the person is" (or only where they're NOT).
//
// It only runs while a domain is active, so normal play doesn't pay for it.

import { MODELS } from '../models'
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision'

const MODEL = MODELS.body

export class BodyMask {
  canvas = document.createElement('canvas')            // the finished, feathered mask (what domains use)
  private ctx = this.canvas.getContext('2d')!
  private raw = document.createElement('canvas')        // unblurred mask, before feathering
  private rawCtx = this.raw.getContext('2d')!
  private prev: Float32Array | null = null              // last frame's confidence, for smoothing
  private hasPrev = false
  private seg: ImageSegmenter | null = null
  private img: ImageData | null = null
  ready = false

  async load(delegate: 'GPU' | 'CPU') {
    const vision = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe-wasm`)
    this.seg = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    })
  }

  /** forget the old mask (new cast: don't flash or blend in the silhouette from last time) */
  reset() {
    this.ready = false
    this.hasPrev = false
  }

  /** Update the mask from the current video frame. */
  update(video: HTMLVideoElement, now: number) {
    if (!this.seg) return
    // Callback style: the mask data is only valid INSIDE the callback (it lives on the GPU),
    // so we copy it into our own ImageData right there.
    this.seg.segmentForVideo(video, now, (result) => {
      const mask = result.confidenceMasks?.[0]
      if (!mask) return
      // Half resolution (1/4 of the work). Three things keep the edge clean:
      //  1. AVERAGE each 2x2 block instead of picking one pixel -> anti-aliased, no staircase
      //  2. TEMPORAL SMOOTHING: blend 65% new + 35% last frame -> edges stop flickering
      //     (weighted toward NEW so a fast-moving hand doesn't leave a ghost trail)
      //  3. FEATHER: soft confidence curve + a small blur when copying to the output canvas
      const { width, height } = mask
      const W = width >> 1, H = height >> 1
      if (this.raw.width !== W || this.raw.height !== H) {
        this.raw.width = this.canvas.width = W
        this.raw.height = this.canvas.height = H
        this.img = this.rawCtx.createImageData(W, H)
        this.img.data.fill(255) // RGB stays white forever; we only update alpha below
        this.prev = new Float32Array(W * H)
        this.hasPrev = false
      }
      const conf = mask.getAsFloat32Array()
      const px = this.img!.data, prev = this.prev!
      for (let y = 0; y < H; y++) {
        const r0 = y * 2 * width, r1 = r0 + width
        for (let x = 0; x < W; x++) {
          const i = y * W + x, x2 = x * 2
          let c = (conf[r0 + x2] + conf[r0 + x2 + 1] + conf[r1 + x2] + conf[r1 + x2 + 1]) * 0.25
          if (this.hasPrev) c = c * 0.65 + prev[i] * 0.35
          prev[i] = c
          // soft edge: 0.2..0.8 confidence -> 0..1 (wider ramp than before = no hard stair edge)
          px[i * 4 + 3] = c <= 0.2 ? 0 : c >= 0.8 ? 255 : (c - 0.2) * 425
        }
      }
      this.hasPrev = true
      this.rawCtx.putImageData(this.img!, 0, 0)
      this.ctx.clearRect(0, 0, W, H)
      this.ctx.filter = 'blur(1px)' // feather (1px at half res = 2px on screen)
      this.ctx.drawImage(this.raw, 0, 0)
      this.ctx.filter = 'none'
      this.ready = true
    })
  }
}
