/**
 * Whisper transcription worker.
 *
 * Runs @huggingface/transformers (transformers.js) in a dedicated worker so
 * model loading + inference never block the UI thread. One worker instance is
 * spawned per transcription run and terminated afterwards, which releases the
 * WASM heap and model memory (aggressive cleanup requirement).
 */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
import type { TranscribeRequest, WorkerOutbound } from '../transcription/messages'
import type { Word } from '../transcription/types'

// Minimal `self` typing (the project's tsconfig uses the DOM lib; the full
// DedicatedWorkerGlobalScope interface lives in the WebWorker lib which would
// conflict when both are active).
declare const self: {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent) => void) | null
}

// --- environment -----------------------------------------------------------
// ONNX Runtime must load its WASM from our own origin: under COEP
// (Cross-Origin-Embedder-Policy: require-corp) no-cors CDN fetches are blocked.
const wasmEnv = env.backends.onnx?.wasm
if (!wasmEnv) {
  throw new Error('transformers.js: ONNX WASM backend unavailable in this build')
}
wasmEnv.wasmPaths = '/ort/'

// Never try local files; always fetch from the HF Hub (browser-cache backed).
env.allowLocalModels = false
env.allowRemoteModels = true

// Use up to 4 threads — requires crossOriginIsolated, which the app enables
// via COOP/COEP headers (transformers.js falls back to 1 thread if not).
wasmEnv.numThreads = Math.max(
  1,
  Math.min(4, typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 2),
)

const MODEL_ID = 'Xenova/whisper-tiny.en'

let transcriber: AutomaticSpeechRecognitionPipeline | null = null

function post(message: WorkerOutbound) {
  self.postMessage(message)
}

async function loadModel(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (transcriber) return transcriber
  post({ type: 'status', stage: 'loading-model' })

  // v3's pipeline() overloads infer a monstrous union across every model
  // type; cast the loader to a narrow signature to keep TS happy (TS2590).
  const load = pipeline as unknown as (
    task: 'automatic-speech-recognition',
    model: string,
    options: {
      device?: string
      dtype?: string
      progress_callback?: (msg: unknown) => void
    },
  ) => Promise<AutomaticSpeechRecognitionPipeline>
  transcriber = await load('automatic-speech-recognition', MODEL_ID, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: (msg) => {
      const m = msg as { status?: string; file?: string; loaded?: number; total?: number }
      if (m.status === 'progress' && typeof m.file === 'string') {
        post({
          type: 'progress',
          file: m.file.split('/').pop() ?? m.file,
          loaded: m.loaded ?? 0,
          total: m.total ?? 0,
        })
      }
    },
  })
  return transcriber
}

/** Whisper word-level output shape (return_timestamps: 'word'). */
interface WordChunkOutput {
  text: string
  timestamp: [number, number]
}

function toWords(output: { chunks?: WordChunkOutput[] }): Word[] {
  const words: Word[] = []
  for (const chunk of output.chunks ?? []) {
    const word = chunk.text.trim()
    if (!word) continue
    if (!Array.isArray(chunk.timestamp) || chunk.timestamp.length !== 2) continue
    const [start, end] = chunk.timestamp
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    words.push({ word, start, end })
  }
  return words
}

self.onmessage = async (event: MessageEvent<TranscribeRequest>) => {
  const req = event.data
  if (req?.type !== 'transcribe') return
  const audio = req.audio

  try {
    const asr = await loadModel()

    post({ type: 'status', stage: 'transcribing' })
    // Long-form audio is chunked internally (30 s windows + 5 s stride) so
    // transcripts beyond the ~30 s context stay coherent.
    const output = await asr(audio, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
    })

    const text = String((output as { text?: unknown }).text ?? '').trim()
    post({ type: 'done', words: toWords(output as { chunks?: WordChunkOutput[] }), text })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    post({ type: 'error', message })
  }
}
