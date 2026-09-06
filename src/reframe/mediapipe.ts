/**
 * MediaPipe FaceDetector bootstrap.
 *
 * The tasks-vision WASM runtime is vendored same-origin at /mediapipe/
 * (required under COEP). The tiny BlazeFace model (~225 KB) is fetched from
 * Google's CORS-enabled model hub the first time and served from the browser
 * HTTP cache afterwards.
 */
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision'

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'

let cached: Promise<FaceDetector> | null = null
let progressTarget = 0
let progressLoaded = 0

/** Streams the model download so the UI can show real progress. */
async function fetchModelBytes(): Promise<Uint8Array> {
  const res = await fetch(MODEL_URL)
  if (!res.ok || !res.body) throw new Error(`Face model download failed (HTTP ${res.status})`)
  const total = Number(res.headers.get('Content-Length')) || 0
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      loaded += value.length
      progressLoaded = loaded
      progressTarget = total
    }
  }
  const out = new Uint8Array(loaded)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

export interface MediaPipeProgress {
  stage: 'runtime' | 'model' | 'detector'
  fraction: number | null
}

/**
 * Ensures the FaceDetector is created exactly once per page load (runtime +
 * model downloads happen only on first use; later runs are instant).
 */
export function getFaceDetector(
  onProgress?: (p: MediaPipeProgress) => void,
): Promise<FaceDetector> {
  if (!cached) {
    cached = (async () => {
      onProgress?.({ stage: 'runtime', fraction: null })
      const fileset = await FilesetResolver.forVisionTasks('/mediapipe/')
      onProgress?.({ stage: 'model', fraction: 0 })
      const modelBytes = await fetchModelBytes()
      onProgress?.({ stage: 'detector', fraction: 1 })
      const detector = await FaceDetector.createFromOptions(fileset, {
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.5,
        baseOptions: {
          // CPU delegate: portable and plenty fast for BlazeFace at 2-3 fps.
          delegate: 'CPU',
          modelAssetBuffer: modelBytes,
        },
      })
      return detector
    })()
  }
  return cached
}

export function modelDownloadFraction(): number | null {
  return progressTarget > 0 ? progressLoaded / progressTarget : null
}
