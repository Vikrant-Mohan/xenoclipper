import { decodeToWhisperInput } from '../lib/audio'
import type { TranscribeRequest, WorkerOutbound } from './messages'
import type { Transcript } from './types'

export interface TranscribeEvents {
  /** Audio is being decoded/resampled on the main thread. */
  onDecoding(): void
  /** Whisper model is downloading/initializing in the worker. */
  onModelLoading(file: string | null, progress: number | null): void
  /** Inference is running in the worker. */
  onTranscribing(): void
}

export interface TranscribeController {
  /** Resolves with the word-level transcript on success. */
  promise: Promise<Transcript>
  /** Terminates the worker and rejects `promise`. Safe to call repeatedly. */
  cancel(): void
}

export class TranscriptionCancelledError extends Error {
  constructor() {
    super('Transcription cancelled')
    this.name = 'TranscriptionCancelledError'
  }
}

/**
 * Runs the full Phase 2 pipeline for one file:
 *   1. decode the file's audio to 16 kHz mono (main thread)
 *   2. hand the samples to a fresh Whisper worker
 *   3. the worker downloads the quantized model (first run only), transcribes,
 *      and posts back word-level timestamps
 *   4. the worker is terminated, releasing all WASM/model memory
 */
export function transcribeVideo(file: File, events: TranscribeEvents): TranscribeController {
  let worker: Worker | null = null
  let settled = false

  let resolvePromise!: (t: Transcript) => void
  let rejectPromise!: (e: Error) => void
  const promise = new Promise<Transcript>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  const settle = (fn: () => void) => {
    if (settled) return
    settled = true
    worker?.terminate()
    worker = null
    fn()
  }

  const fail = (err: Error) => settle(() => rejectPromise(err))
  const succeed = (transcript: Transcript) => settle(() => resolvePromise(transcript))

  // Async pipeline (fire and forget; outcomes flow through succeed/fail).
  void (async () => {
    try {
      events.onDecoding()
      const { samples, durationSec } = await decodeToWhisperInput(file)
      if (settled) return // cancelled during decoding

      // Spawn a dedicated worker for this run. Vite bundles the worker.
      worker = new Worker(new URL('../workers/transcribe.worker.ts', import.meta.url), {
        type: 'module',
        name: 'xenoclipper-whisper',
      })

      worker.onmessage = (e: MessageEvent<WorkerOutbound>) => {
        const msg = e.data
        switch (msg.type) {
          case 'status':
            if (msg.stage === 'loading-model') events.onModelLoading(null, null)
            else events.onTranscribing()
            break
          case 'progress':
            events.onModelLoading(msg.file, msg.total > 0 ? msg.loaded / msg.total : null)
            break
          case 'done':
            succeed({
              words: msg.words,
              text: msg.text,
              audioDurationSec: durationSec,
            })
            break
          case 'error':
            fail(new Error(msg.message))
            break
        }
      }

      worker.onerror = (e: ErrorEvent) => {
        fail(new Error(`Transcription worker crashed: ${e.message || 'unknown error'}`))
      }

      // Transfer the PCM buffer — zero copies into the worker.
      const request: TranscribeRequest = { type: 'transcribe', audio: samples }
      worker.postMessage(request, [samples.buffer])
    } catch (err) {
      fail(err instanceof Error ? err : new Error(String(err)))
    }
  })()

  return {
    promise,
    cancel() {
      if (settled) return
      settle(() => rejectPromise(new TranscriptionCancelledError()))
    },
  }
}
