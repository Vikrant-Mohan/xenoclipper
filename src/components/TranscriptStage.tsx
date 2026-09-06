import { useEffect, useState } from 'react'
import { formatDuration } from '../lib/format'
import { CaptionPreview } from './CaptionPreview'
import { CaptionStylePicker } from './CaptionStylePicker'
import type { CaptionStyle } from '../render/caption'
import type { Transcript, TranscribeState } from '../transcription/types'
import type { Word } from '../transcription/types'

interface TranscriptStageProps {
  state: TranscribeState
  transcript: Transcript | null
  /** False while no video is loaded. */
  canRun: boolean
  onRun: () => void
  onCancel: () => void
  /** Clears errors so the user can start again. */
  onDismissError: () => void
  /** Caption look shared with the render stage. */
  style: CaptionStyle
  onStyleChange: (style: CaptionStyle) => void
  /** Words with user timing corrections applied (drives the live preview). */
  previewWords: Word[]
  /** Indices the user has re-timed in the preview. */
  adjusted: Set<number>
  onAdjustWord: (index: number, deltaSec: number) => void
  onResetWords: () => void
}

function useElapsed(startedAt: number | null, active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active || !startedAt) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [active, startedAt])
  return active && startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0
}

const busyPhases = new Set(['decoding-audio', 'loading-model', 'transcribing'])

export function TranscriptStage({
  state,
  transcript,
  canRun,
  onRun,
  onCancel,
  onDismissError,
  style,
  onStyleChange,
  previewWords,
  adjusted,
  onAdjustWord,
  onResetWords,
}: TranscriptStageProps) {
  const busy = busyPhases.has(state.phase)
  const elapsed = useElapsed(state.startedAt, busy)

  // ---------------------------------------------------------------- running
  if (busy) {
    const label =
      state.phase === 'decoding-audio'
        ? 'Extracting audio'
        : state.phase === 'loading-model'
          ? 'Downloading Whisper model'
          : 'Transcribing'
    const detail =
      state.phase === 'decoding-audio'
        ? 'Decoding your file and resampling to 16 kHz mono — your browser\u2019s codecs at work.'
        : state.phase === 'loading-model'
          ? state.modelFile
            ? `Fetching ${state.modelFile} from Hugging Face (cached after the first run)…`
            : 'Initializing the ONNX runtime…'
          : 'Whisper is reading through the audio window by window. First run downloads the model, so it can take a while.'

    return (
      <section className="animate-rise mx-auto mt-4 w-full max-w-5xl rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-indigo-400/30 bg-indigo-500/10">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5.5 animate-spin text-indigo-300" style={{ animationDuration: '1.2s' }} aria-hidden="true">
              <path d="M12 3a9 9 0 1 0 9 9" strokeLinecap="round" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[15px] italic font-normal text-zinc-100">
              {label}
              {elapsed > 0 && <span className="ml-2 font-normal text-zinc-500">· {formatDuration(elapsed)}</span>}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">{detail}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 rounded-xl border border-white/15 px-3.5 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-rose-200"
          >
            Cancel
          </button>
        </div>

        {state.phase === 'loading-model' && (
          <div className="mt-4">
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-linear-to-r from-indigo-400 via-purple-400 to-pink-400 transition-[width] duration-300"
                style={{ width: `${Math.round((state.progress ?? 0) * 100)}%` }}
              />
            </div>
            <p className="mt-1.5 text-right text-[11px] text-zinc-500">
              {Math.round((state.progress ?? 0) * 100)}%
            </p>
          </div>
        )}
        {state.phase !== 'loading-model' && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-linear-to-r from-indigo-400 to-pink-400" />
          </div>
        )}
      </section>
    )
  }

  // ------------------------------------------------------------------ error
  if (state.phase === 'error' && state.error) {
    return (
      <section className="animate-rise mx-auto mt-4 w-full max-w-5xl rounded-3xl border border-rose-400/25 bg-rose-500/[0.06] p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-300">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4.5" aria-hidden="true">
              <path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-rose-200">Transcription failed</p>
            <p className="mt-1 text-xs leading-relaxed text-rose-300/90">{state.error}</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={onRun}
                className="rounded-xl bg-rose-400/90 px-4 py-2 text-xs font-semibold text-rose-950 transition-colors hover:bg-rose-300"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={onDismissError}
                className="rounded-xl border border-white/15 px-4 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/5"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </section>
    )
  }

  // ------------------------------------------------------------- idle / done
  const hasTranscript = transcript !== null && transcript.words.length > 0
  const lastEnd = hasTranscript ? transcript.words[transcript.words.length - 1].end : null

  return (
    <section className="mx-auto mt-4 w-full max-w-5xl rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-sm">
      {hasTranscript ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-300">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="size-4.5" aria-hidden="true">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </span>
              <div>
                <p className="font-display text-[15px] italic font-normal text-zinc-100">Transcript ready</p>
                <p className="text-xs text-zinc-500">
                  {transcript.words.length.toLocaleString()} words
                  {lastEnd !== null ? ` · covers ~${formatDuration(lastEnd)} of speech` : ''}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onRun}
              className="rounded-xl border border-white/15 px-3.5 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/5"
            >
              Re-transcribe
            </button>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="flex max-h-72 min-h-40 flex-col rounded-2xl border border-white/10 bg-black/30 p-4">
              <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                Transcript
              </p>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <p className="text-[13px] leading-7 text-zinc-300">{transcript.text}</p>
              </div>
            </div>

            <div className="flex min-h-40 flex-col rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                  Caption style
                </p>
                <p className="text-[10px] text-zinc-600">applied at render</p>
              </div>
              <div className="mt-3">
                <CaptionStylePicker style={style} onChange={onStyleChange} />
              </div>
              <CaptionPreview
                words={previewWords}
                style={style}
                adjusted={adjusted}
                onAdjust={onAdjustWord}
                onResetAll={onResetWords}
              />
            </div>
          </div>

          <p className="mt-4 border-t border-white/10 pt-4 text-xs text-zinc-500">
            Word-level timestamps are locked in — the curation step below turns
            them into ranked, selectable viral clips, and your caption style
            carries straight into the render.
          </p>
        </>
      ) : (
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-4.5" aria-hidden="true">
                <path d="M12 18.5a6.5 6.5 0 1 0-6.4-5.4l-.6.6H3.5l1.6 1.8L3.4 18h2.6l.7-.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M9 10.5h6M9 13h4" strokeLinecap="round" />
              </svg>
            </span>
            <div>
              <p className="font-display text-[15px] italic font-normal text-zinc-100">Transcribe with local Whisper</p>
              <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-zinc-400">
                Whisper (tiny.en, quantized) runs in a background worker and returns
                word-level timestamps. First run downloads the ~40 MB model from
                Hugging Face; afterwards it's cached in your browser.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onRun}
            disabled={!canRun}
            title={canRun ? undefined : 'Load a video first'}
            className={
              canRun
                ? 'shrink-0 rounded-xl bg-linear-to-r from-indigo-500 via-purple-500 to-pink-500 px-5 py-2.5 font-display text-[15px] italic font-normal text-white shadow-lg shadow-purple-950/40 transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400'
                : 'shrink-0 cursor-not-allowed rounded-xl bg-white/10 px-5 py-2.5 text-sm font-semibold text-zinc-500'
            }
          >
            Transcribe locally
          </button>
        </div>
      )}
    </section>
  )
}
