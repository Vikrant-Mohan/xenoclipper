/** One AI-suggested viral clip (mirrors the Groq JSON contract). */
export interface ViralClip {
  /** Start of the clip in seconds (within the source video). */
  startTime: number
  /** End of the clip in seconds (within the source video). */
  endTime: number
  /** Predicted virality 1–100. */
  viralScore: number
  /** The hook — the first line the viewer hears/sees. */
  hookText: string
  /** Why this moment would perform. */
  rationale: string
}

/** Visible states of the Phase 3 curation pipeline in the UI. */
export type CuratePhase = 'idle' | 'running' | 'done' | 'error'

export interface CurateState {
  phase: CuratePhase
  error: string | null
  /** When the current run started (elapsed-time display). */
  startedAt: number | null
}
