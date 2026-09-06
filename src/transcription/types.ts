/** A single transcribed word with its time span (seconds). */
export interface Word {
  word: string
  start: number
  end: number
}

/** Result of a full transcription run. */
export interface Transcript {
  /** Every recognized word with timestamps, in order. */
  words: Word[]
  /** The whole transcript as plain text (words joined). */
  text: string
  /** Duration of the audio that was transcribed, in seconds. */
  audioDurationSec: number | null
}

/** Visible states of the transcription pipeline in the UI. */
export type TranscribePhase =
  | 'idle'
  | 'decoding-audio' // main thread: decode + resample to 16 kHz mono
  | 'loading-model' // worker: downloading/initializing Whisper
  | 'transcribing' // worker: running inference over the audio
  | 'done'
  | 'error'

export interface TranscribeState {
  phase: TranscribePhase
  /** Model download progress 0..1 (loading-model phase). */
  progress: number | null
  /** File currently being downloaded (loading-model phase). */
  modelFile: string | null
  error: string | null
  /** When the current run started (for elapsed-time display). */
  startedAt: number | null
}
