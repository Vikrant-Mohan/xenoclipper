import type { Word } from './types'

/** Sent from main thread → worker to start a transcription run. */
export interface TranscribeRequest {
  type: 'transcribe'
  /** 16 kHz mono float32 PCM samples. The buffer is transferred, not copied. */
  audio: Float32Array
}

/** Worker → main thread updates (model loading progress, inference stage). */
export type TranscribeProgress =
  | { type: 'status'; stage: 'loading-model' | 'transcribing' }
  | { type: 'progress'; file: string; loaded: number; total: number }

/** Worker → main thread terminal messages. */
export type TranscribeResponse =
  | { type: 'done'; words: Word[]; text: string }
  | { type: 'error'; message: string }

export type WorkerOutbound =
  | TranscribeProgress
  | TranscribeResponse
