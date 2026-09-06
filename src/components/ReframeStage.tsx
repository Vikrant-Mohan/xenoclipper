import type { ViralClip } from '../curation/types'
import type { ReframeResult, ReframeState } from '../reframe/types'

interface ReframeStageProps {
  clip: ViralClip | null
  state: ReframeState
  result: ReframeResult | null
  onRun: () => void
  onCancel: () => void
  onDismissError: () => void
  onDeselect: () => void
}

const mss = (sec: number): string => {
  const t = Math.max(0, Math.floor(sec))
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Tiny inline chart of the pan path (crop-center X over clip time). */
function PanPath({ result }: { result: ReframeResult }) {
  const w = 100
  const h = 36
  const key = result.keyframes
  const xs = key.map((k) => k.cx)
  const min = Math.min(...xs)
  const max = Math.max(...xs)
  const range = Math.max(0.0001, max - min)
  const dur = key.length > 1 ? key[key.length - 1].t : 1
  const points = key
    .map((k) => {
      const px = (k.t / dur) * w
      const py = h - 4 - ((k.cx - min) / range) * (h - 8)
      return `${px.toFixed(1)},${py.toFixed(1)}`
    })
    .join(' ')
  const midY = h / 2
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-black/30 px-3 pb-2 pt-1">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-zinc-500">
        <span>crop-center X over time</span>
        <span className="font-mono normal-case">
          {mss(0)} – {mss(dur)}s
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-1 h-10 w-full" preserveAspectRatio="none" aria-hidden="true">
        {/* center reference */}
        <line x1="0" y1={midY} x2={w} y2={midY} stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" strokeDasharray="2 2" />
        <polyline
          points={points}
          fill="none"
          stroke="url(#panGrad)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx={w} cy={points.split(' ').at(-1)?.split(',')[1] ?? midY} r="2" fill="#6ee7b7" />
        <defs>
          <linearGradient id="panGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#a3e635" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  )
}

export function ReframeStage({
  clip,
  state,
  result,
  onRun,
  onCancel,
  onDismissError,
  onDeselect,
}: ReframeStageProps) {
  if (!clip) return null

  const running =
    state.phase === 'preparing' || state.phase === 'tracking' || state.phase === 'computing'
  const runLabels: Record<string, string> = {
    preparing: 'Preparing face detector',
    tracking: 'Tracking faces',
    computing: 'Computing crop path',
  }
  const progress = state.progress
  const frac = progress && progress.total ? Math.min(1, progress.done / progress.total) : null

  // ----------------------------------------------------------------- running
  if (running) {
    const isTracking = state.phase === 'tracking'
    return (
      <section className="animate-rise mx-auto mt-4 w-full max-w-5xl rounded-3xl border border-indigo-400/25 bg-indigo-500/[0.06] p-5">
        <div className="flex items-center gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-indigo-400/30 bg-indigo-500/10">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5.5 animate-spin text-indigo-300" style={{ animationDuration: '1.2s' }} aria-hidden="true">
              <path d="M12 3a9 9 0 1 0 9 9" strokeLinecap="round" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[15px] italic font-normal text-zinc-100">
              {runLabels[state.phase]}
              {isTracking && progress ? (
                <span className="ml-2 font-normal text-zinc-500">
                  · frame {Math.min(progress.done, progress.total ?? progress.done)}/
                  {progress.total}
                </span>
              ) : null}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">
              {isTracking
                ? 'Sampling the clip and locating the dominant face with MediaPipe…'
                : state.phase === 'preparing'
                  ? progress?.label ?? 'Loading the MediaPipe runtime (once per visit)…'
                  : 'Smoothing the face track into a camera-like 9:16 path…'}
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
        {(isTracking || state.phase === 'preparing') && (
          <div className="mt-4">
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-linear-to-r from-indigo-400 via-purple-400 to-pink-400 transition-[width] duration-200"
                style={{ width: `${Math.round((frac ?? 0) * 100)}%` }}
              />
            </div>
            <p className="mt-1.5 text-right text-[11px] text-zinc-500">
              {frac !== null ? `${Math.round(frac * 100)}%` : '…'}
            </p>
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
            <p className="text-sm font-semibold text-rose-200">Face tracking failed</p>
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
                onClick={onDeselect}
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
  const clipDur = Math.max(0, Math.round(clip.endTime - clip.startTime))

  return (
    <section
      className={`animate-rise mx-auto mt-4 w-full max-w-5xl rounded-3xl border p-5 backdrop-blur-sm ${
        done
          ? 'border-emerald-400/25 bg-emerald-400/[0.05]'
          : 'border-white/10 bg-white/[0.03]'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${
              done ? 'bg-emerald-400/15 text-emerald-300' : 'bg-indigo-500/15 text-indigo-300'
            }`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-5" aria-hidden="true">
              <path d="M12 3a4 4 0 0 0-4 4v4a4 4 0 1 0 2.5-3.7V7a1.5 1.5 0 1 1 3 0v.3A4 4 0 0 0 16 11V7a4 4 0 0 0-4-4z" />
              <path d="M5.5 13.5a7 7 0 0 0 13 0" strokeLinecap="round" />
            </svg>
          </span>
          <div>
            <p className="font-display text-[15px] italic font-normal text-zinc-100">
              {done ? '9:16 crop path computed' : 'Auto-reframe to 9:16'}
            </p>
            <p className="text-xs text-zinc-500">
              Selected clip {mss(clip.startTime)} – {mss(clip.endTime)} · {clipDur}s · “{clip.hookText}”
            </p>
          </div>
        </div>
        {!done && (
          <button
            type="button"
            onClick={onDeselect}
            className="shrink-0 rounded-xl border border-white/15 px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/5"
          >
            Change clip
          </button>
        )}
      </div>

      {done && result ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Mode</p>
              <p className="mt-0.5 text-sm text-zinc-200">
                {result.mode === 'face-tracked' ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-300">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="size-3.5" aria-hidden="true">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    Face-tracked
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-amber-300">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5" aria-hidden="true">
                      <path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                    </svg>
                    Center crop (no face found)
                  </span>
                )}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Face coverage</p>
              <p className="mt-0.5 text-sm text-zinc-200">
                {result.facesDetected}/{result.totalFrames} frames
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Crop box</p>
              <p className="mt-0.5 font-mono text-sm text-zinc-200">
                {result.cropWidth}×{result.cropHeight} of {result.sourceWidth}×{result.sourceHeight}
              </p>
            </div>
          </div>

          <PanPath result={result} />

          <div className="mt-4 flex flex-col gap-2 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-zinc-500">
              {result.keyframes.length} path keyframes (1/sec) drive the
              panning-crop render below, where karaoke captions get burned in.
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onRun}
                className="rounded-xl border border-white/15 px-4 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/5"
              >
                Re-track
              </button>
              <span className="text-[11px] text-zinc-500">
                Captions + render ↓
              </span>
            </div>
          </div>
        </>
      ) : (
        <div className="mt-4 flex flex-col items-start justify-between gap-4 border-t border-white/10 pt-4 sm:flex-row sm:items-center">
          <p className="max-w-xl text-xs leading-relaxed text-zinc-400">
            XenoClipper samples the clip at ~2–3 fps, tracks the dominant face
            with MediaPipe, and computes a smooth 9:16 pan path that keeps the
            subject centered (falls back to a center crop when no face is
            visible). Runs fully locally — nothing uploaded.
          </p>
          <button
            type="button"
            onClick={onRun}
            className="shrink-0 rounded-xl bg-linear-to-r from-indigo-500 via-purple-500 to-pink-500 px-5 py-2.5 font-display text-[15px] italic font-normal text-white shadow-lg shadow-purple-950/40 transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            Track face &amp; compute crop
          </button>
        </div>
      )}
    </section>
  )
}
