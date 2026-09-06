import { useEffect, useState } from 'react'
import { formatBytes, formatDuration } from '../lib/format'
import type { ViralClip } from '../curation/types'
import type { ReframeResult } from '../reframe/types'
import { fontFor, positionFor, sizeFor, themeFor, type CaptionStyle } from '../render/caption'
import type { RenderResult, RenderState } from '../render/types'
import type { Word } from '../transcription/types'

interface RenderStageProps {
  clip: ViralClip | null
  words: Word[]
  reframe: ReframeResult | null
  state: RenderState
  result: RenderResult | null
  /** Caption look chosen in the transcript preview. */
  style: CaptionStyle
  onRun: () => void
  onCancel: () => void
  onDismissError: () => void
  onDifferentClip: () => void
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

const mss = (sec: number): string => {
  const t = Math.max(0, Math.floor(sec))
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const busyPhases = new Set(['loading-ffmpeg', 'preparing', 'encoding'])

function StyleChips({ style }: { style: CaptionStyle }) {
  const theme = themeFor(style)
  const size = sizeFor(style)
  const pos = positionFor(style)
  const chip =
    'flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-zinc-300'
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={chip}>
        <span className="size-2 rounded-full ring-1 ring-black/50" style={{ backgroundColor: theme.fill }} />
        {fontFor(style).name} · {theme.name} theme
      </span>
      <span className={chip}>{size.label} text</span>
      <span className={chip}>{pos.label}</span>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-zinc-200">{value}</p>
    </div>
  )
}

export function RenderStage({
  clip,
  words,
  reframe,
  state,
  result,
  style,
  onRun,
  onCancel,
  onDismissError,
  onDifferentClip,
}: RenderStageProps) {
  const busy = busyPhases.has(state.phase)
  const elapsed = useElapsed(state.startedAt, busy)

  // Wait until Phase 4 produced a crop path for the selected clip.
  if (!clip || !reframe) return null

  const runLabels: Record<string, string> = {
    'loading-ffmpeg': 'Starting FFmpeg.wasm',
    preparing: 'Preparing the render',
    encoding: 'Rendering with karaoke captions',
  }
  const pct = state.progress?.percent ?? null

  // ----------------------------------------------------------------- running
  if (busy) {
    return (
      <section className="animate-rise mx-auto mt-4 w-full max-w-5xl rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-pink-400/30 bg-pink-500/10">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5.5 animate-spin text-pink-300" style={{ animationDuration: '1.2s' }} aria-hidden="true">
              <path d="M12 3a9 9 0 1 0 9 9" strokeLinecap="round" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[15px] italic font-normal text-zinc-100">
              {runLabels[state.phase]}
              {elapsed > 0 && <span className="ml-2 font-normal text-zinc-500">· {formatDuration(elapsed)}</span>}
              {pct !== null && (
                <span className="ml-2 font-normal text-zinc-400">{pct}%</span>
              )}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">
              {state.phase === 'encoding'
                ? pct !== null
                  ? state.progress?.label ?? 'Encoding H.264 in your browser…'
                  : 'Encoding H.264 in your browser — this is the heavy step (FFmpeg.wasm, single-threaded).'
                : state.phase === 'loading-ffmpeg'
                  ? state.progress?.label ?? 'Downloading the ~30 MB FFmpeg.wasm runtime (once per visit)…'
                  : state.progress?.label ?? 'Trimming, panning to 9:16 and styling captions…'}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 rounded-xl border border-white/15 px-3.5 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-rose-200"
          >
            Cancel
          </button>
        </div>
        <div className="mt-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            {pct !== null ? (
              <div
                className="h-full rounded-full bg-linear-to-r from-indigo-400 via-purple-400 to-pink-400 transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            ) : (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-linear-to-r from-indigo-400 to-pink-400" />
            )}
          </div>
          <p className="mt-1.5 text-right text-[11px] text-zinc-500">
            {state.phase === 'encoding' && pct === null ? 'warm-up…' : pct !== null ? `${pct}%` : ''}
          </p>
        </div>
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
            <p className="text-sm font-semibold text-rose-200">Render failed</p>
            <p className="mt-1 text-xs leading-relaxed text-rose-300/90">{state.error}</p>
            <div className="mt-3 flex flex-wrap gap-2">
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
              <button
                type="button"
                onClick={onDifferentClip}
                className="rounded-xl border border-white/15 px-4 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/5"
              >
                Pick another clip
              </button>
            </div>
          </div>
        </div>
      </section>
    )
  }

  // ------------------------------------------------------------ done / idle
  const done = state.phase === 'done' && result
  const inClip = words.filter(
    (w) => w.end > clip.startTime && w.start < clip.endTime,
  )
  const clipDur = Math.max(0, Math.round(clip.endTime - clip.startTime))

  return (
    <section
      className={`animate-rise mx-auto mt-4 w-full max-w-5xl rounded-3xl border p-5 backdrop-blur-sm ${
        done ? 'border-emerald-400/25 bg-emerald-400/[0.05]' : 'border-white/10 bg-white/[0.03]'
      }`}
    >
      {done && result ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-300">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden="true">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </span>
              <div>
                <p className="font-display text-[15px] italic font-normal text-zinc-100">Your clip is ready</p>
                <p className="text-xs text-zinc-500">
                  {mss(clip.startTime)} – {mss(clip.endTime)} · {clipDur}s · “{clip.hookText}”
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onDifferentClip}
                className="rounded-xl border border-white/15 px-3.5 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/5"
              >
                Different clip
              </button>
              <button
                type="button"
                onClick={onRun}
                className="rounded-xl border border-white/15 px-3.5 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/5"
              >
                Re-render
              </button>
              <a
                href={result.url}
                download={`xenoclipper-${mss(clip.startTime).replace(':', '-')}.mp4`}
                className="rounded-xl bg-linear-to-r from-indigo-500 via-purple-500 to-pink-500 px-5 py-2.5 font-display text-[15px] italic font-normal text-white shadow-lg shadow-purple-950/40 transition-transform hover:scale-[1.02]"
              >
                Download MP4
              </a>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-5 lg:flex-row">
            <div className="flex justify-center rounded-2xl border border-white/10 bg-black/40 p-3 lg:w-64 lg:shrink-0">
              <video
                src={result.url}
                controls
                playsInline
                preload="metadata"
                className="aspect-[9/16] max-h-[440px] w-auto rounded-lg bg-black object-contain"
              />
            </div>
            <div className="min-w-0 flex-1 space-y-4">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                <Stat label="Duration" value={`${result.durationSec.toFixed(1)} s`} />
                <Stat label="Resolution" value={`${result.width}×${result.height}`} />
                <Stat label="Size" value={formatBytes(result.sizeBytes)} />
                <Stat
                  label="Captions"
                  value={`${result.captionCount} words · ${result.captionLines} lines`}
                />
                <Stat label="Crop" value={result.cropMode === 'face-tracked' ? 'Face-tracked' : 'Center (no face)'} />
                <Stat label="Audio" value={result.hasAudio ? 'Mixed in (AAC)' : 'None in source'} />
              </div>
              <StyleChips style={style} />
              <p className="text-xs leading-relaxed text-zinc-500">
                Rendered 100% locally: trimmed to the selected window, panned along
                the face-tracked 9:16 path, and karaoke captions burned in with
                libass. Nothing was uploaded — the bytes never left this tab.
              </p>
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-pink-500/15 text-pink-300">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-4.5" aria-hidden="true">
                <path d="M15 10l4.6-3.6a.6.6 0 0 1 1 .5v10.2a.6.6 0 0 1-1 .5L15 14M5 18h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <div>
              <p className="font-display text-[15px] italic font-normal text-zinc-100">Burn in captions &amp; render</p>
              <div className="flex flex-col gap-2.5">
                <p className="max-w-xl text-xs leading-relaxed text-zinc-400">
                  FFmpeg.wasm trims {mss(clip.startTime)}–{mss(clip.endTime)} ({clipDur}s), pans
                  along the {reframe.keyframes.length}-point crop path, and burns in{' '}
                  {inClip.length} karaoke words that highlight in your chosen style.
                  Everything encodes locally — nothing is uploaded.
                </p>
                <StyleChips style={style} />
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <button
              type="button"
              onClick={onRun}
              className="rounded-xl bg-linear-to-r from-indigo-500 via-purple-500 to-pink-500 px-5 py-2.5 font-display text-[15px] italic font-normal text-white shadow-lg shadow-purple-950/40 transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              Render clip →
            </button>
            <button
              type="button"
              onClick={onDifferentClip}
              className="rounded-xl border border-white/15 px-3 py-1.5 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-white/5"
            >
              Pick another clip
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
