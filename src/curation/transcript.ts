import type { Transcript } from '../transcription/types'

/**
 * A run of speech with a timestamp — the unit the curation LLM reasons over.
 */
export interface Segment {
  start: number
  end: number
  text: string
}

const SENTENCE_END = /[.!?…]+$/

/**
 * Groups word-level timestamps into sentence-ish segments. Words that carry
 * sentence-final punctuation close a segment; very long runs without
 * punctuation are split every ~240 characters so payload lines stay readable.
 */
export function wordsToSegments(words: Transcript['words']): Segment[] {
  const segments: Segment[] = []
  let buffer: typeof words = []
  let bufferText = ''

  const flush = () => {
    if (buffer.length === 0) return
    segments.push({
      start: buffer[0].start,
      end: buffer[buffer.length - 1].end,
      text: bufferText.trim(),
    })
    buffer = []
    bufferText = ''
  }

  for (const w of words) {
    buffer.push(w)
    bufferText += (bufferText ? ' ' : '') + w.word
    const endsSentence = SENTENCE_END.test(w.word)
    if (endsSentence || bufferText.length >= 240) flush()
  }
  flush()
  return segments
}

/** [0:04] → "0:04" style stamps for the payload. */
export function stamp(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const total = Math.floor(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Renders a compact, timestamped transcript for the LLM:
 *
 *   [0:00] We must find a new home in the stars. [0:03]
 *
 * Lines longer than ~200 chars are wrapped so the model sees clean rows.
 * Payload is capped at ~90k characters (llama-3.3-70b handles far more, but
 * cost/latency stay low and the opening minutes matter most for clips).
 */
export function compileTranscriptForLlm(
  transcript: Transcript,
  maxChars = 90_000,
): string {
  const segments = wordsToSegments(transcript.words)
  const lines: string[] = []
  let budget = maxChars

  for (const seg of segments) {
    if (budget <= 0) break
    const line = `[${stamp(seg.start)}] ${seg.text}`
    if (line.length > budget) break
    lines.push(line)
    budget -= line.length + 1
  }
  return lines.join('\n')
}
