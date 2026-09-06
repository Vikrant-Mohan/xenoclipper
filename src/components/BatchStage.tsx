import { useCallback, useEffect, useRef, useState } from 'react'
import type { ViralClip } from '../curation/types'
import { formatBytes, formatDuration } from '../lib/format'
import { ReframeCancelledError, runReframe } from '../reframe/client'
import type { ReframeResult } from '../reframe/types'
import { fontFor, positionFor, sizeFor, themeFor, type CaptionStyle } from '../render/caption'
import { renderClip, RenderCancelledError } from '../render/client'
import type { RenderResult } from '../render/types'
import type { Word } from '../transcription/types'
import type { VideoSource } from '../types'

type JobPhase = 'queued' | 'reframing' | 'rendering' | 'done' | 'error'

interface Job {
  phase: JobPhase
  /** Progress label shown while the job runs. */
  label: string
  /** Frames tracked during face-tracking, when known. */
  done: number | null
  total: number | null
  /** Encode percent (null while indeterminate). */
  pct: number | null
  error: string | null
  result: RenderResult | null
  cropMode: 'face-tracked' | 'fallback-center' | null
}

interface BatchStageProps {
  video: VideoSource
  /** Every curated clip (jobs follow this order). */
  clips: ViralClip[]
  /** Word timings used for captions (already includes user corrections). */
  words: Word[]
  style: CaptionStyle
  /** Bumped whenever the source video or transcript changes → results wipe. */
  resetToken: number
}

const mss = (sec: number): string => {
  const t = Math.max(0, Math.floor(sec))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

const errMsg = (e: unknown): string =>
  e instanceof Error && e.message ? e.message : String(e)

function freshJob(): Job {
  return {
    phase: 'queued',
    label: 'Waiting…',
    done: null,
    total: null,
    pct: null,
    error: null,
    result: null,
    cropMode: null,
  }
}

const STATUS_UI: Record<
  JobPhase,
  { label: string; chip: string; dot: string }
> = {
  queued: {
    label: 'Queued',
    chip: 'border-white/15 bg-white/[0.04] text-zinc-400',
    dot: 'bg-zinc-500',
  },
  reframing: {
    label: 'Tracking faces',
    chip: 'border-indigo-400/30 bg-indigo-500/10 text-indigo-300',
    dot: 'bg-indigo-400',
  },
  rendering: {
    label: 'Rendering',
    chip: 'border-pink-400/30 bg-pink-500/10 text-pink-300',
    dot: 'bg-pink-400',
  },
  done: {
    label: 'Done',
    chip: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
    dot: 'bg-emerald-400',
  },
  error: {
    label: 'Failed',
    chip: 'border-rose-400/30 bg-rose-500/10 text-rose-300',
    dot: 'bg-rose-400',
  },
}

/**
 * Batch renderer: runs face-track → karaoke render for every curated clip, one
 * at a time (each run needs FFmpeg's undivided attention), streaming per-clip
 * progress. Every clip gets its own 9:16 pan path from a fresh Phase 4 run.
 * Results accumulate in a gallery below; nothing is uploaded anywhere.
 */
export function BatchStage({ video, clips, words, style, resetToken }: BatchStageProps) {
  const [running, setRunning] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [jobs, setJobs] = useState<Job[] | null>(null)

  const runningRef = useRef(false)
  const runIdRef = useRef(0)
  const activeRef = useRef<{ cancel: () => void } | null>(null)

  const revokeAll = useCallback(() => {
    setJobs((prev) => {
      if (prev) for (const j of prev) if (j.result) URL.revokeObjectURL(j.result.url)
      return null
    })
  }, [])

  // A new video, transcription, or clip list makes every old result stale.
  // Kill any in-flight run and free the blob URLs.
  useEffect(() => {
    runningRef.current = false
    runIdRef.current += 1
    activeRef.current?.cancel()
    activeRef.current = null
    setRunning(false)
    setStartedAt(null)
    revokeAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips, resetToken])

  // Free blob URLs on unmount.
  useEffect(() => () => {
    setJobs((prev) => {
      if (prev) for (const j of prev) if (j.result) URL.revokeObjectURL(j.result.url)
      return null
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const patchJob = useCallback((index: number, patch: Partial<Job>) => {
    setJobs((prev) => {
      if (!prev || index >= prev.length) return prev
      const next = prev.slice()
      next[index] = { ...next[index], ...patch }
      return next
    })
  }, [])

  /**
   * Starts processing the given clip indices sequentially. `indices === null`
   * means every clip (the "render all" action); otherwise just those clips
   * (per-row retry — existing results on other rows are kept).
   */
  const start = useCallback(
    (indices: number[] | null) => {
      if (runningRef.current) return
      const targets = indices ?? clips.map((_, i) => i)
      if (targets.length === 0) return
      const runId = ++runIdRef.current
      const targetSet = new Set(targets)
      runningRef.current = true
      setRunning(true)
      setStartedAt(Date.now())
      setJobs((prev) => {
        const base =
          prev ?? clips.map(() => freshJob())
        return base.map((job, i) => (targetSet.has(i) ? freshJob() : job))
      })

      void (async () => {
        try {
          for (const i of targets) {
            if (runIdRef.current !== runId) return
            const clip = clips[i]

            // ------------------------------------------- face tracking -----
            patchJob(i, { phase: 'reframing', label: 'Starting face tracker…' })
            const tracker = runReframe(video, clip, {
              onProgress({ phase, done, total, label }) {
                if (runIdRef.current !== runId) return
                patchJob(i, {
                  phase: 'reframing',
                  label: label ?? phase,
                  done: done ?? null,
                  total: total ?? null,
                })
              },
            })
            activeRef.current = tracker
            let reframe: ReframeResult
            try {
              reframe = await tracker.promise
            } catch (e) {
              activeRef.current = null
              if (runIdRef.current !== runId || e instanceof ReframeCancelledError) return
              patchJob(i, { phase: 'error', error: errMsg(e), label: 'Failed' })
              continue
            }
            if (runIdRef.current !== runId) return

            // --------------------------------------------- render ----------
            patchJob(i, { phase: 'rendering', label: 'Starting encoder…', pct: null })
            const render = renderClip(
              video,
              clip,
              reframe,
              words,
              {
                onProgress({ phase, label, percent }) {
                  if (runIdRef.current !== runId) return
                  patchJob(i, {
                    phase: 'rendering',
                    label: label ?? phase,
                    pct: percent ?? null,
                  })
                },
              },
              style,
            )
            activeRef.current = render
            try {
              const result = await render.promise
              if (runIdRef.current !== runId) return
              patchJob(i, {
                phase: 'done',
                label: 'Done',
                error: null,
                result,
                cropMode: result.cropMode,
                pct: 100,
              })
            } catch (e) {
              if (runIdRef.current !== runId || e instanceof RenderCancelledError) return
              patchJob(i, { phase: 'error', error: errMsg(e), label: 'Failed' })
            }
            activeRef.current = null
          }
        } finally {
          activeRef.current = null
          if (runIdRef.current === runId) {
            runningRef.current = false
            setRunning(false)
          }
        }
      })()
    },
    [clips, video, words, style, patchJob],
  )

  const stop = useCallback(() => {
    runningRef.current = false
    runIdRef.current += 1
    activeRef.current?.cancel()
    activeRef.current = null
    setRunning(false)
    setStartedAt(null)
    setJobs((prev) => {
      if (!prev) return prev
      const next = prev.map((j) =>
        j.phase === 'reframing' || j.phase === 'rendering' || j.phase === 'queued'
          ? freshJob()
          : j,
      )
      // Collapse the board when nothing finished — no stale “Queued” wall.
      return next.some((j) => j.phase === 'done' || j.phase === 'error') ? next : null
    })
  }, [])

  const removeResult = useCallback(
    (i: number) => {
      setJobs((prev) => {
        if (!prev || i >= prev.length) return prev
        const next = prev.slice()
        const job = next[i]
        if (job.result) URL.revokeObjectURL(job.result.url)
        next[i] = { ...freshJob(), phase: 'queued' }
        return next
      })
    },
    [],
  )

  const downloadAll = useCallback(() => {
    if (!jobs) return
    jobs.forEach((job, i) => {
      if (job.phase !== 'done' || !job.result) return
      const a = document.createElement('a')
      a.href = job.result.url
      a.download = `xenoclipper-${i + 1}-${mss(clips[i].startTime).replace(':', '-')}.mp4`
      document.body.appendChild(a)
      a.click()
      a.remove()
    })
  }, [jobs, clips])

  const theme = themeFor(style)
  const size = sizeFor(style)
  const pos = positionFor(style)
  const elapsed =
    running && startedAt ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : 0
  const doneCount = jobs?.filter((j) => j.phase === 'done').length ?? 0
  const boardVisible = running || (jobs !== null && jobs.some((j) => j.phase !== 'queued'))
  const downloadName = (i: number, startTime: number) =>
    `xenoclipper-${i + 1}-${mss(startTime).replace(':', '-')}.mp4`

  return (
    <section className="animate-rise mx-auto mt-4 w-full max-w-5xl rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-sm">
      {/* ----------------------------------------------------------- header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-xl bg-pink-500/15 text-pink-300">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-4.5" aria-hidden="true">
              <path d="M15 10l4.6-3.6a.6.6 0 0 1 1 .5v10.2a.6.6 0 0 1-1 .5L15 14M5 18h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M9 2v2m3-1.5V5M6 2.5V4" strokeLinecap="round" strokeWidth={1.4} />
            </svg>
          </span>
          <div>
            <p className="font-display text-[15px] italic font-normal text-zinc-100">Batch render</p>
            <p className="text-xs text-zinc-500">
              {running
                ? `Processing clip ${(jobs ?? []).filter((j) => j.phase !== 'queued').length} of ${clips.length} · ${formatDuration(elapsed)}`
                : doneCount > 0
                  ? `${doneCount} of ${clips.length} rendered`
                  : `Reframes + renders all ${clips.length} clips, one at a time`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-zinc-400 sm:flex">
            <span className="size-2 rounded-full ring-1 ring-black/50" style={{ backgroundColor: theme.fill }} />
            {fontFor(style).name} · {theme.name} · {size.label} · {pos.label}
          </span>
          {running ? (
            <button
              type="button"
              onClick={stop}
              className="shrink-0 rounded-xl border border-white/15 px-4 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-rose-200"
            >
              Stop batch
            </button>
          ) : (
            <>
              {doneCount > 0 && (
                <button
                  type="button"
                  onClick={downloadAll}
                  className="shrink-0 rounded-xl border border-white/15 px-4 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/5"
                >
                  Download all ({doneCount})
                </button>
              )}
              <button
                type="button"
                onClick={() => start(null)}
                className="shrink-0 rounded-xl bg-linear-to-r from-indigo-500 via-purple-500 to-pink-500 px-4 py-2 font-display text-[15px] italic font-normal text-white shadow-lg shadow-purple-950/40 transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                Render all {clips.length} clips →
              </button>
            </>
          )}
        </div>
      </div>

      {/* -------------------------------------------------- overall progress */}
      {running && (
        <div className="mt-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-linear-to-r from-indigo-400 via-purple-400 to-pink-400 transition-[width] duration-300"
              style={{
                width: `${(doneCount / clips.length) * 100}%`,
              }}
            />
          </div>
          <p className="mt-1 text-right text-[11px] text-zinc-500">
            {doneCount} / {clips.length} complete
          </p>
        </div>
      )}

      {/* --------------------------------------------------------- job board */}
      {boardVisible && jobs && (
        <ul className="mt-4 space-y-2.5">
          {jobs.map((job, i) => {
            const clip = clips[i]
            if (!clip) return null
            const status = STATUS_UI[job.phase]
            const busy = job.phase === 'reframing' || job.phase === 'rendering'
            return (
              <li
                key={`${clip.startTime}-${i}`}
                className="rounded-2xl border border-white/10 bg-white/[0.02] p-3.5"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="text-xs font-bold text-zinc-500">#{i + 1}</span>
                  <span className={`rounded-full border px-2 py-0.5 font-mono text-[11px] text-zinc-400 ${job.phase === 'done' && job.result ? 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300' : 'border-white/10 bg-white/[0.04]'}`}>
                    {mss(clip.startTime)} – {mss(clip.endTime)}
                  </span>
                  <span className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${status.chip}`}>
                    <span className={`size-1.5 rounded-full ${job.phase === 'reframing' || job.phase === 'rendering' ? 'animate-pulse ' : ''}${status.dot}`} />
                    {status.label}
                    {job.phase === 'reframing' && job.total ? ` ${job.done ?? 0}/${job.total}` : ''}
                    {job.phase === 'rendering' && job.pct !== null ? ` ${job.pct}%` : ''}
                  </span>
                  <p className="min-w-0 flex-1 truncate text-xs text-zinc-500">
                    {busy && job.label ? job.label : `“${clip.hookText}”`}
                  </p>
                  {!running && job.phase === 'error' && (
                    <button
                      type="button"
                      onClick={() => start([i])}
                      className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:bg-white/5"
                    >
                      Retry
                    </button>
                  )}
                  {!running && job.phase === 'done' && job.result && (
                    <button
                      type="button"
                      onClick={() => start([i])}
                      className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:bg-white/5"
                    >
                      Re-render
                    </button>
                  )}
                  {!running && job.phase === 'done' && job.result && (
                    <button
                      type="button"
                      onClick={() => removeResult(i)}
                      className="rounded-lg border border-transparent px-2 py-1 text-[11px] font-medium text-zinc-500 transition-colors hover:border-white/15 hover:text-rose-300"
                      title="Remove this result"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {busy && (
                  <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/10">
                    {job.phase === 'rendering' && job.pct !== null ? (
                      <div
                        className="h-full rounded-full bg-linear-to-r from-indigo-400 to-pink-400 transition-[width] duration-300"
                        style={{ width: `${job.pct}%` }}
                      />
                    ) : (
                      <div className="h-full w-1/3 animate-pulse rounded-full bg-linear-to-r from-indigo-400 to-pink-400" />
                    )}
                  </div>
                )}

                {job.phase === 'error' && job.error && (
                  <p className="mt-2 rounded-xl border border-rose-400/20 bg-rose-500/[0.06] px-3 py-2 text-xs leading-relaxed text-rose-300/90">
                    {job.error}
                  </p>
                )}

                {job.phase === 'done' && job.result && (
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="flex shrink-0 justify-center rounded-xl border border-white/10 bg-black/40 p-2 sm:w-24">
                      <video
                        src={job.result.url}
                        controls
                        playsInline
                        preload="metadata"
                        className="aspect-[9/16] max-h-36 w-auto rounded-md bg-black object-contain"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap gap-1.5">
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-zinc-300">
                          {job.result.width}×{job.result.height}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-zinc-300">
                          {job.result.durationSec.toFixed(1)} s
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-zinc-300">
                          {formatBytes(job.result.sizeBytes)}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-zinc-300">
                          {job.result.cropMode === 'face-tracked' ? 'Face-tracked' : 'Center crop'}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-zinc-300">
                          {job.result.captionCount} captions
                        </span>
                      </div>
                      <a
                        href={job.result.url}
                        download={downloadName(i, clip.startTime)}
                        className="mt-2.5 inline-block rounded-lg bg-linear-to-r from-indigo-500 via-purple-500 to-pink-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg shadow-purple-950/40 transition-transform hover:scale-[1.02]"
                      >
                        Download MP4
                      </a>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* -------------------------------------------------- waiting hint */}
      {!boardVisible && !running && (
        <p className="mt-3 text-xs leading-relaxed text-zinc-500">
          Each clip is trimmed, face-tracked for its own 9:16 pan path, and
          rendered with {theme.name} karaoke captions — entirely in this browser.
          FFmpeg.wasm is single-threaded, so {clips.length} clip{clips.length === 1 ? '' : 's'} run
          one after another; you can watch the board fill in below.
        </p>
      )}
    </section>
  )
}
