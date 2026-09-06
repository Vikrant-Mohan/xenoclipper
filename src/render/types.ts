/** Visible states of the Phase 5 render pipeline in the UI. */
export type RenderPhase =
  | 'idle'
  | 'loading-ffmpeg' // downloading/instantiating the FFmpeg.wasm runtime
  | 'preparing' // writing inputs, building the .ass + panning filter
  | 'encoding' // ffmpeg is running (trim + crop + burn-in)
  | 'done'
  | 'error'

export interface RenderState {
  phase: RenderPhase
  error: string | null
  /** Progress detail during `encoding` (0..100 or null while indeterminate). */
  progress: { percent: number | null; label: string } | null
  /** When the current run started (elapsed-time display). */
  startedAt: number | null
}

/** Outcome of one successful render. */
export interface RenderResult {
  /** Blob URL of the finished MP4 (revoke via `disposeRenderResult`). */
  url: string
  sizeBytes: number
  /** Final encoded dimensions (9:16, may be upscaled from the crop box). */
  width: number
  height: number
  /** Output duration ≈ clip length, seconds. */
  durationSec: number
  /** How many word captions were burned in. */
  captionCount: number
  /** How many caption chunks (on-screen lines) were rendered. */
  captionLines: number
  /** Whether the source had an audio track that was re-encoded in. */
  hasAudio: boolean
  /** Crop mode inherited from Phase 4. */
  cropMode: 'face-tracked' | 'fallback-center'
}
