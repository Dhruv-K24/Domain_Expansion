import './style.css'
import { FilesetResolver, HandLandmarker, DrawingUtils, type NormalizedLandmark, type Category } from '@mediapipe/tasks-vision'
import { HandTracker, TUNING, type TrackedHand } from './tracking/handTracker'
import { recoverHand } from './tracking/recover'
import { signFeatures } from './signs/features'
import { classify, type Sample } from './signs/knn'
import { DOMAINS, domainName, loadDataset, appendSamples, deleteLabel } from './signs/dataset'
import { Caster } from './signs/caster'
import { BodyMask } from './fx/segmenter'
import { MalevolentShrine } from './domains/malevolentShrine'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const video = $<HTMLVideoElement>('cam')
const canvas = $<HTMLCanvasElement>('overlay')
const ctx = canvas.getContext('2d')!
const fxCanvas = $<HTMLCanvasElement>('fx')
const fxCtx = fxCanvas.getContext('2d')!
const vignette = $('vignette')
const statusEl = $('status'), fpsEl = $('fps')
const castLabel = $('castLabel'), castMeta = $('castMeta'), holdFill = $('holdFill')
const expansion = $('expansion'), expansionName = $('expansionName')
const domainSelect = $<HTMLSelectElement>('domainSelect'), recordBtn = $<HTMLButtonElement>('recordBtn')
const recordInfo = $('recordInfo'), countsEl = $('counts'), clearBtn = $<HTMLButtonElement>('clearBtn')

const MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

// Two detectors from the same model:
//  - "video" one: the main tracker, runs every frame, remembers the previous frame.
//  - "image" one: used only for recovery on zoomed crops (each crop is a fresh picture).
async function createDetectors() {
  const vision = await FilesetResolver.forVisionTasks('/mediapipe-wasm')
  const make = async (delegate: 'GPU' | 'CPU') => ({
    video: await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.4,
      minHandPresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
    }),
    image: await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'IMAGE',
      numHands: 1,
      minHandDetectionConfidence: 0.3, // a bit braver: we already expect a hand in this crop
    }),
    delegate,
  })
  try {
    return await make('GPU')
  } catch (e) {
    console.warn('GPU delegate failed, using CPU', e)
    return await make('CPU')
  }
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, frameRate: { ideal: 60 } },
  })
  video.srcObject = stream
  await new Promise<void>((r) => (video.onloadedmetadata = () => r()))
  await video.play()
  canvas.width = fxCanvas.width = video.videoWidth
  canvas.height = fxCanvas.height = video.videoHeight
}

// ---------------- Training panel ----------------
let samples: Sample[] = []
let recordingUntil = 0
let recordStartsAt = 0
let recId = 0               // every recording gets an id, so we can test "unseen recordings" later
let current: Sample[] = []  // samples of the recording in progress
let unsaved: Sample[] = []  // recorded but NOT confirmed on disk yet

for (const d of DOMAINS) {
  const o = document.createElement('option')
  o.value = d.id
  o.textContent = d.user ? `${d.name} (${d.user})` : d.name
  domainSelect.append(o)
}

function renderCounts() {
  countsEl.innerHTML = ''
  if (unsaved.length) {
    const li = document.createElement('li')
    li.textContent = `⚠ ${unsaved.length} samples NOT saved yet (retrying…)`
    li.style.color = '#ff6b6b'
    countsEl.append(li)
  }
  for (const d of DOMAINS) {
    const n = samples.filter((s) => s.label === d.id).length
    if (!n) continue
    const li = document.createElement('li')
    li.textContent = `${d.name}: ${n}`
    countsEl.append(li)
  }
}

function startRecording() {
  if (recordingUntil || !datasetReady) return
  const now = performance.now()
  recordStartsAt = now + 1500 // 1.5s to get your hands into position
  recordingUntil = recordStartsAt + 3000
  recId = Date.now()
  current = []
  recordBtn.disabled = true
}

// Load saved samples RIGHT AWAY — not after the camera/models — so the panel shows them
// even if the camera is slow or fails.
let datasetReady = false
loadDataset()
  .then((d) => {
    samples = d
    datasetReady = true
    recordInfo.textContent = `Loaded ${d.length} saved samples ✔`
    renderCounts()
  })
  .catch((e) => {
    console.error(e)
    recordInfo.textContent = '⚠ Could not load saved samples — recording is disabled so nothing gets overwritten. Restart the dev server and refresh.'
    recordBtn.disabled = true
  })

// Saving: send ONLY the new samples. They leave the "unsaved" buffer only after the
// server confirms, and the server's reply tells us the total now on disk (proof).
let saving = false
async function flushUnsaved() {
  if (saving || unsaved.length === 0) return
  saving = true
  const batch = unsaved.slice()
  try {
    const total = await appendSamples(batch)
    unsaved = unsaved.slice(batch.length)
    recordInfo.textContent = `Saved ✔ ${batch.length} new · ${total} on disk. Record again from a different angle.`
  } catch (e) {
    recordInfo.textContent = `⚠ Save failed (${(e as Error).message}). Is the dev server running? Retrying every 5s — don't close this tab.`
  } finally {
    saving = false
    renderCounts()
  }
}
setInterval(flushUnsaved, 5000) // keep retrying anything that didn't save

// Closing/refreshing the tab with unsaved samples? The browser shows "Leave site?".
window.addEventListener('beforeunload', (e) => {
  if (unsaved.length || current.length) e.preventDefault()
})

recordBtn.onclick = startRecording
clearBtn.onclick = async () => {
  const id = domainSelect.value
  if (!confirm(`Delete all samples for "${domainName(id)}"?`)) return
  try {
    const total = await deleteLabel(id)
    samples = samples.filter((s) => s.label !== id)
    recordInfo.textContent = `Deleted ✔ · ${total} on disk`
  } catch (e) {
    recordInfo.textContent = `⚠ Delete failed: ${(e as Error).message}`
  }
  renderCounts()
}

let showRaw = false
let testCast = false // press T to fire Malevolent Shrine without doing the sign (for testing visuals)
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLSelectElement) return
  if (e.key.toLowerCase() === 'r') showRaw = !showRaw
  if (e.key.toLowerCase() === 't') testCast = true
  if (e.code === 'Space') { e.preventDefault(); startRecording() }
})

const COLORS = ['#7c5cff', '#ff3d6e']

async function main() {
  try {
    const [det] = await Promise.all([createDetectors(), startCamera()])

    const draw = new DrawingUtils(ctx)
    const tracker = new HandTracker()
    const caster = new Caster()
    const shrine = new MalevolentShrine()
    const body = new BodyMask()
    body.load(det.delegate).catch((e) => console.warn('segmenter failed to load', e)) // loads in background
    let wasCast = false
    let lastFrame = performance.now()
    const ui = document.querySelectorAll<HTMLElement>('#panel, #cast, #hud')

    let lastVideoTime = -1
    let hands: TrackedHand[] = []
    let raw: NormalizedLandmark[][] = []
    let recovered = 0
    let detFrames = 0, renderFrames = 0, fpsTimer = performance.now()

    function loop() {
      const now = performance.now()

      if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime
        const result = det.video.detectForVideo(video, now)
        const landmarks: NormalizedLandmark[][] = [...result.landmarks]
        const handedness: Category[][] = [...result.handedness]

        // Recovery pass: for each lost hand, search a zoomed crop around where we predict it is.
        for (const lost of tracker.lostHands(landmarks, now).slice(0, 1)) { // max 1 per frame (cost)
          const r = recoverHand(det.image, video, lost.center, lost.size, lost.searchScale)
          if (r) { landmarks.push(r.landmarks); handedness.push(r.handedness); recovered++ }
        }

        raw = landmarks
        hands = tracker.update(landmarks, handedness, now)
        detFrames++

        // ---- Signs ----
        const f = signFeatures(hands.filter((h) => !h.coasting))
        // Recording: save this frame's features as an example of the chosen sign
        if (recordingUntil && f && now >= recordStartsAt) {
          current.push({ label: domainSelect.value, f, rec: recId })
        }
        if (recordingUntil) {
          if (now < recordStartsAt) recordInfo.textContent = 'Get ready…'
          else recordInfo.textContent = `Recording ${domainName(domainSelect.value)}… move a little!`
          if (now >= recordingUntil) {
            recordingUntil = 0
            recordBtn.disabled = false
            samples.push(...current)  // use them for classifying right away
            unsaved.push(...current)  // and queue them for saving
            current = []
            recordInfo.textContent = 'Saving…'
            renderCounts()
            flushUnsaved()
          }
        }

        // Classify (paused while recording so it doesn't fire on itself)
        const pred = f && !recordingUntil ? classify(samples, f) : { label: 'none', confidence: 0, distance: Infinity }
        const state = caster.update(pred, now)
        castLabel.textContent = pred.label === 'none' ? '—' : domainName(pred.label)
        castMeta.textContent = f
          ? `votes ${(pred.confidence * 100).toFixed(0)}% · nearest ${isFinite(pred.distance) ? pred.distance.toFixed(2) : '–'}`
          : 'no hands'
        holdFill.style.width = `${state.progress * 100}%`
        // Vignette: nothing for the first half of the hold, then edges darken 50% -> 100%.
        // smoothstep = an S-curve, so it eases in instead of starting abruptly.
        const k = Math.max(0, (state.progress - 0.5) / 0.5)
        const v = state.phase === 'cast' ? (shrine.active ? 0 : 1) : k * k * (3 - 2 * k)
        vignette.style.setProperty('--v', v.toFixed(3))

        // Did a cast JUST happen this frame? (phase went from not-cast to cast)
        const castNow = (state.phase === 'cast' && !wasCast) || testCast
        wasCast = state.phase === 'cast'
        if (castNow) {
          const label = testCast ? 'malevolent_shrine' : state.label
          testCast = false
          if (label === 'malevolent_shrine') shrine.start(fxCanvas.width, fxCanvas.height)
          else {
            expansionName.textContent = domainName(label)
            expansion.classList.add('show')
            setTimeout(() => expansion.classList.remove('show'), 3000)
          }
        }
        if (shrine.active) body.update(video, now)
      }

      // ---- Drawing ----
      const dt = now - lastFrame
      lastFrame = now
      shrine.render(fxCtx, video, body.ready ? body.canvas : null, dt)
      ui.forEach((el) => (el.style.visibility = shrine.active ? 'hidden' : 'visible'))
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (shrine.active) { requestAnimationFrame(loop); return } // no hand dots during the domain
      if (showRaw) for (const r of raw) draw.drawLandmarks(r, { color: '#888', radius: 2 })
      for (const h of hands) {
        ctx.globalAlpha = h.coasting ? 0.25 + 0.5 * h.confidence : 1
        draw.drawConnectors(h.points, HandLandmarker.HAND_CONNECTIONS, { color: COLORS[h.id % 2], lineWidth: 3 })
        draw.drawLandmarks(h.points, { color: '#fff', radius: 3 })
      }
      ctx.globalAlpha = 1
      renderFrames++

      statusEl.textContent =
        hands.length === 0 ? 'No hands' : hands.map((h) => `${h.label}${h.coasting ? ' (predicting)' : ''}`).join(' + ')

      if (now - fpsTimer > 1000) {
        fpsEl.textContent = `detect ${detFrames} fps · draw ${renderFrames} fps · ${det.delegate} · recovered ${recovered}/s · [R] raw`
        detFrames = renderFrames = recovered = 0
        fpsTimer = now
      }
      requestAnimationFrame(loop)
    }
    statusEl.textContent = `Show your hands ✋ (memory ${TUNING.coastMs}ms)`
    loop()
  } catch (err) {
    console.error(err)
    statusEl.textContent = `Error: ${(err as Error).message}`
  }
}

main()
