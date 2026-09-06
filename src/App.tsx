import { useCallback, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { BatchStage } from './components/BatchStage'
import { CurateStage } from './components/CurateStage'
import { DropZone } from './components/DropZone'
import { ReframeStage } from './components/ReframeStage'
import { RenderStage } from './components/RenderStage'
import { SettingsModal } from './components/SettingsModal'
import { TranscriptStage } from './components/TranscriptStage'
import { VideoPanel } from './components/VideoPanel'
import { curateTranscript, CurateCancelledError, type CurateConfig } from './curation/client'
import type { ViralClip, CurateState } from './curation/types'
import { ACCEPT, isVideoFile } from './lib/files'
import { formatBytes } from './lib/format'
import { runReframe, ReframeCancelledError } from './reframe/client'
import type { ReframeResult, ReframeState } from './reframe/types'
import { DEFAULT_CAPTION_STYLE, type CaptionStyle } from './render/caption'
import { disposeRenderUrl, renderClip, RenderCancelledError } from './render/client'
import type { RenderResult, RenderState } from './render/types'
import {
  TranscriptionCancelledError,
  transcribeVideo,
  type TranscribeController,
} from './transcription/client'
import type { Transcript, TranscribeState } from './transcription/types'
import type { VideoSource } from './types'

const STEPS = [
  { id: 1, title: 'Ingest', detail: 'local video file' },
  { id: 2, title: 'Transcribe', detail: 'Whisper · word timings' },
  { id: 3, title: 'Curate', detail: 'Groq gpt-oss-120b' },
  { id: 4, title: 'Reframe', detail: 'face-tracked 9:16' },
  { id: 5, title: 'Render', detail: 'karaoke captions' },
]

/** Highest pipeline phase implemented so far — drives the roadmap UI. */
const ACTIVE_PHASE = 5

const IDLE_TRANSCRIBE: TranscribeState = {
  phase: 'idle',
  progress: null,
  modelFile: null,
  error: null,
  startedAt: null,
}

const IDLE_CURATE: CurateState = {
  phase: 'idle',
  error: null,
  startedAt: null,
}

const IDLE_REFAME: ReframeState = {
  phase: 'idle',
  error: null,
  progress: null,
  startedAt: null,
}

const IDLE_RENDER: RenderState = {
  phase: 'idle',
  error: null,
  progress: null,
  startedAt: null,
}

function makeSource(file: File): VideoSource {
  return {
    file,
    url: URL.createObjectURL(file),
    name: file.name,
    sizeBytes: file.size,
    type: file.type,
    durationSec: null,
    width: null,
    height: null,
    previewFailed: false,
  }
}

export default function App() {
  const [video, setVideo] = useState<VideoSource | null>(null)
  const [transcribeState, setTranscribeState] = useState<TranscribeState>(IDLE_TRANSCRIBE)
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [curateState, setCurateState] = useState<CurateState>(IDLE_CURATE)
  const [clips, setClips] = useState<ViralClip[] | null>(null)
  const [selectedClip, setSelectedClip] = useState<ViralClip | null>(null)
  const [reframeState, setReframeState] = useState<ReframeState>(IDLE_REFAME)
  const [reframeResult, setReframeResult] = useState<ReframeResult | null>(null)
  const [renderState, setRenderState] = useState<RenderState>(IDLE_RENDER)
  const [renderResult, setRenderResult] = useState<RenderResult | null>(null)
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(DEFAULT_CAPTION_STYLE)
  /** Per-word timing corrections (word index → shift in seconds) from the
   *  caption preview. Applied on top of Whisper's timestamps at render time. */
  const [wordDeltas, setWordDeltas] = useState<Record<number, number>>({})
  /** Bumped whenever the source file or transcript changes — resets ephemeral
   *  per-pipeline state like the batch-render results (keyed by this value). */
  const [epoch, setEpoch] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [isolated] = useState(
    () => typeof window !== 'undefined' && window.crossOriginIsolated === true,
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const controllerRef = useRef<TranscribeController | null>(null)
  const curateControllerRef = useRef<{ cancel: () => void } | null>(null)
  const reframeControllerRef = useRef<{ cancel: () => void } | null>(null)
  const renderControllerRef = useRef<{ cancel: () => void } | null>(null)

  /** Transcript words with user timing corrections applied (preview + render). */
  const adjustedWords = useMemo(() => {
    if (!transcript) return []
    if (Object.keys(wordDeltas).length === 0) return transcript.words
    return transcript.words.map((w, i) => {
      const d = wordDeltas[i]
      return d ? { ...w, start: w.start + d, end: w.end + d } : w
    })
  }, [transcript, wordDeltas])

  /** Shift one word's start+end (deltas accumulate; tiny values are dropped). */
  const adjustWord = useCallback((index: number, deltaSec: number) => {
    setWordDeltas((prev) => {
      const next = { ...prev }
      const v = (prev[index] ?? 0) + deltaSec
      if (Math.abs(v) < 0.005) delete next[index]
      else next[index] = v
      return next
    })
  }, [])

  const resetWordDeltas = useCallback(() => setWordDeltas({}), [])

  const openPicker = useCallback(() => inputRef.current?.click(), [])

  const patchVideo = useCallback((patch: Partial<VideoSource>) => {
    setVideo((prev) => (prev ? { ...prev, ...patch } : prev))
  }, [])

  /** Stop any in-flight transcription (terminates the worker → frees WASM). */
  const cancelTranscribe = useCallback(() => {
    controllerRef.current?.cancel()
    controllerRef.current = null
    setTranscribeState(IDLE_TRANSCRIBE)
  }, [])

  /** Stop any in-flight Groq curation request. */
  const cancelCurate = useCallback(() => {
    curateControllerRef.current?.cancel()
    curateControllerRef.current = null
    setCurateState(IDLE_CURATE)
  }, [])

  /** Stop any in-flight face-tracking run. */
  const cancelReframe = useCallback(() => {
    reframeControllerRef.current?.cancel()
    reframeControllerRef.current = null
    setReframeState(IDLE_REFAME)
  }, [])

  /** Stop any in-flight render (terminates the FFmpeg worker). */
  const cancelRender = useCallback(() => {
    renderControllerRef.current?.cancel()
    renderControllerRef.current = null
    setRenderState(IDLE_RENDER)
  }, [])

  const selectFile = useCallback(
    (file: File) => {
      if (!isVideoFile(file)) return
      cancelTranscribe() // old video's transcript is invalid; stop + clear
      cancelCurate()
      cancelReframe()
      cancelRender()
      setTranscript(null)
      setWordDeltas({})
      setClips(null)
      setSelectedClip(null)
      setReframeResult(null)
      setRenderResult((prev) => {
        if (prev) disposeRenderUrl(prev.url)
        return null
      })
      setVideo((prev) => {
        if (prev) URL.revokeObjectURL(prev.url) // free the previous blob URL
        return makeSource(file)
      })
      setEpoch((e) => e + 1)
    },
    [cancelTranscribe, cancelCurate, cancelReframe, cancelRender],
  )

  const startTranscribe = useCallback(async () => {
    if (!video || controllerRef.current) return
    setTranscript(null)
    setWordDeltas({})
    setTranscribeState({
      phase: 'decoding-audio',
      progress: null,
      modelFile: null,
      error: null,
      startedAt: Date.now(),
    })

    const controller = transcribeVideo(video.file, {
      onDecoding() {
        setTranscribeState((s) =>
          s.phase === 'decoding-audio' ? s : { ...s, phase: 'decoding-audio' },
        )
      },
      onModelLoading(file, progress) {
        setTranscribeState((s) => ({
          ...s,
          phase: 'loading-model',
          modelFile: file ?? s.modelFile,
          progress: progress ?? s.progress,
        }))
      },
      onTranscribing() {
        setTranscribeState((s) => ({ ...s, phase: 'transcribing' }))
      },
    })
    controllerRef.current = controller

    try {
      const result = await controller.promise
      setTranscript(result)
      setEpoch((e) => e + 1) // old batch renders were captioned from the old timing
      setTranscribeState((s) => ({ ...s, phase: 'done' }))
    } catch (err) {
      if (err instanceof TranscriptionCancelledError) {
        setTranscribeState(IDLE_TRANSCRIBE)
        return
      }
      const message =
        err instanceof Error && err.message ? err.message : 'Something went wrong.'
      setTranscribeState((s) => ({
        ...s,
        phase: 'error',
        error: message,
        progress: null,
      }))
    } finally {
      controllerRef.current = null
    }
  }, [video])

  const startCurate = useCallback(
    (config: CurateConfig) => {
      if (!transcript || curateControllerRef.current) return
      if (!config.providerId) return
      cancelReframe() // a new suggestion list invalidates the old selection
      setClips(null)
      setSelectedClip(null)
      setReframeResult(null)
      setCurateState({ phase: 'running', error: null, startedAt: Date.now() })

      const controller = curateTranscript(transcript, config, {
        onRunning() {
          setCurateState((s) => ({ ...s, phase: 'running' }))
        },
      })
      curateControllerRef.current = controller

      void controller.promise
        .then((result) => {
          setClips(result.clips)
          setCurateState({ phase: 'done', error: null, startedAt: null })
        })
        .catch((err: unknown) => {
          if (err instanceof CurateCancelledError) {
            setCurateState(IDLE_CURATE)
            return
          }
          const message =
            err instanceof Error && err.message ? err.message : 'Something went wrong.'
          setCurateState((s) => ({ ...s, phase: 'error', error: message }))
        })
        .finally(() => {
          curateControllerRef.current = null
        })
    },
    [transcript, cancelReframe],
  )

  /** Selects a clip for reframing (clears any previous crop path + render). */
  const selectClip = useCallback(
    (clip: ViralClip | null) => {
      cancelReframe()
      cancelRender()
      setSelectedClip(clip)
      setReframeResult(null)
      setRenderResult((prev) => {
        if (prev) disposeRenderUrl(prev.url)
        return null
      })
    },
    [cancelReframe, cancelRender],
  )

  const startReframe = useCallback(() => {
    if (!video || !selectedClip || reframeControllerRef.current) return
    cancelRender() // a new crop path invalidates the previous render
    setReframeResult(null)
    setRenderResult((prev) => {
      if (prev) disposeRenderUrl(prev.url)
      return null
    })
    setReframeState({
      phase: 'preparing',
      error: null,
      progress: null,
      startedAt: Date.now(),
    })

    const controller = runReframe(video, selectedClip, {
      onProgress({ phase, done, total, label }) {
        setReframeState((s) => ({
          ...s,
          phase,
          progress: { done: done ?? 0, total: total ?? 0, label: label ?? '' },
        }))
      },
    })
    reframeControllerRef.current = controller

    void controller.promise
      .then((result) => {
        setReframeResult(result)
        setReframeState({ phase: 'done', error: null, progress: null, startedAt: null })
      })
      .catch((err: unknown) => {
        if (err instanceof ReframeCancelledError) {
          setReframeState(IDLE_REFAME)
          return
        }
        const message =
          err instanceof Error && err.message ? err.message : 'Something went wrong.'
        setReframeState((s) => ({ ...s, phase: 'error', error: message }))
      })
      .finally(() => {
        reframeControllerRef.current = null
      })
  }, [video, selectedClip, cancelRender])

  const startRender = useCallback(() => {
    if (!video || !selectedClip || !reframeResult || renderControllerRef.current) return
    if (!transcript) return
    setRenderResult((prev) => {
      if (prev) disposeRenderUrl(prev.url)
      return null
    })
    setRenderState({
      phase: 'loading-ffmpeg',
      error: null,
      progress: null,
      startedAt: Date.now(),
    })

    const controller = renderClip(video, selectedClip, reframeResult, adjustedWords, {
      onProgress({ phase, label, percent }) {
        setRenderState((s) => ({
          ...s,
          phase,
          progress: { percent: percent ?? null, label: label ?? '' },
        }))
      },
    }, captionStyle)
    renderControllerRef.current = controller

    void controller.promise
      .then((result) => {
        setRenderResult(result)
        setRenderState({ phase: 'done', error: null, progress: null, startedAt: null })
      })
      .catch((err: unknown) => {
        if (err instanceof RenderCancelledError) {
          setRenderState(IDLE_RENDER)
          return
        }
        const message =
          err instanceof Error && err.message ? err.message : 'Something went wrong.'
        setRenderState((s) => ({ ...s, phase: 'error', error: message }))
      })
      .finally(() => {
        renderControllerRef.current = null
      })
  }, [video, selectedClip, reframeResult, adjustedWords, captionStyle])

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) selectFile(file)
    e.target.value = '' // allow re-selecting the same file
  }

  function stepStatus(stepId: number): 'done' | 'current' | 'upcoming' {
    if (stepId < ACTIVE_PHASE) return 'done'
    if (stepId === ACTIVE_PHASE) return 'current'
    return 'upcoming'
  }

  return (
    <div
      className="relative flex min-h-dvh flex-col"
      style={{
        background:
          'radial-gradient(55rem 55rem at 115% -10%, rgba(52,211,153,0.15), transparent 60%),' +
          'radial-gradient(45rem 45rem at -15% 105%, rgba(34,197,94,0.13), transparent 60%),' +
          'radial-gradient(38rem 38rem at 55% 120%, rgba(163,230,53,0.07), transparent 60%), #040605',
      }}
    >
      {/* Header */}
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 pb-6 pt-6">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-linear-to-br from-indigo-500 via-purple-500 to-pink-500 shadow-lg shadow-purple-950/40">
            <svg viewBox="0 0 24 24" className="size-4.5 text-white" aria-hidden="true">
              <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
            </svg>
          </span>
          <span className="font-tech text-[16px] font-bold leading-none tracking-tight text-zinc-50">
            XenoClipper
          </span>
          <span className="hidden rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400 sm:inline">
            OpusClip, but client-side
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <div
            title={
              isolated
                ? 'COEP: require-corp + COOP: same-origin are active — SharedArrayBuffer (FFmpeg) is available'
                : 'Serve via `npm run dev` or a deploy with isolation headers (see README) — FFmpeg.wasm needs this'
            }
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
              isolated
                ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
                : 'border-amber-400/25 bg-amber-400/10 text-amber-300'
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${isolated ? 'bg-emerald-400' : 'bg-amber-400'}`}
            />
            {isolated ? 'Isolated · SharedArrayBuffer ready' : 'Isolation off — run dev / preview'}
          </div>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            title="Settings — AI provider, key & model"
            className="flex size-9 items-center justify-center rounded-xl border border-white/12 bg-white/[0.03] text-zinc-300 transition-colors hover:border-white/30 hover:bg-white/5 hover:text-zinc-100"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="size-4.5" aria-hidden="true">
              <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.35a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.65 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.65h.01A1.7 1.7 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-10 pt-4">
        {/* Hero */}
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="font-display text-balance text-4xl italic leading-[1.12] text-zinc-50 sm:text-6xl">
            Long video in.{' '}
            <span className="bg-linear-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              Viral clips out.
            </span>
          </h1>
          <p className="mt-3 text-pretty text-sm leading-relaxed text-zinc-400 sm:text-base">
            XenoClipper transcribes with local Whisper, picks your viral 15–60&nbsp;s
            moments (avg. ~30&nbsp;s) with AI, reframes to 9:16 by tracking faces,
            and burns in karaoke captions — every step runs in this browser.
            Free. Private. No backend.
          </p>
        </div>

        {/* Pipeline roadmap */}
        <ol className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
          {STEPS.map((step) => {
            const status = stepStatus(step.id)
            const styles = {
              done: 'border-emerald-400/25 bg-emerald-400/[0.06]',
              current: 'border-indigo-400/45 bg-indigo-500/[0.08] ring-1 ring-indigo-400/25',
              upcoming: 'border-white/10 bg-white/[0.02] opacity-70',
            }[status]
            return (
              <li key={step.id} className={`rounded-2xl border px-3 py-2.5 ${styles}`}>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`flex size-4.5 items-center justify-center rounded-full text-[9px] font-bold ${
                      status === 'done'
                        ? 'bg-emerald-400/20 text-emerald-300'
                        : status === 'current'
                          ? 'bg-indigo-400/25 text-indigo-200'
                          : 'bg-white/10 text-zinc-500'
                    }`}
                  >
                    {status === 'done' ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" className="size-2.5" aria-hidden="true">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    ) : (
                      step.id
                    )}
                  </span>
                  <span
                    className={`font-display text-[13px] italic leading-none ${
                      status === 'upcoming' ? 'text-zinc-400' : 'text-zinc-50'
                    }`}
                  >
                    {step.title}
                  </span>
                </div>
                <p className="mt-1 text-[10px] leading-snug text-zinc-500">{step.detail}</p>
              </li>
            )
          })}
        </ol>

        {/* Ingest + transcription area */}
        <div className="mt-8 flex flex-1 items-start justify-center">
          {video ? (
            <div className="w-full">
              <VideoPanel video={video} onMetadata={patchVideo} onReplace={openPicker} />
              <TranscriptStage
                state={transcribeState}
                transcript={transcript}
                canRun={true}
                onRun={() => void startTranscribe()}
                onCancel={cancelTranscribe}
                onDismissError={() =>
                  setTranscribeState((s) => ({ ...s, phase: 'idle', error: null }))
                }
                style={captionStyle}
                onStyleChange={setCaptionStyle}
                previewWords={adjustedWords}
                adjusted={new Set(Object.keys(wordDeltas).map(Number))}
                onAdjustWord={adjustWord}
                onResetWords={resetWordDeltas}
              />
              <CurateStage
                key={`curate-${epoch}`}
                transcript={transcript}
                state={curateState}
                clips={clips}
                selected={selectedClip}
                onRun={startCurate}
                onCancel={cancelCurate}
                onDismissError={() =>
                  setCurateState((s) => ({ ...s, phase: 'idle', error: null }))
                }
                onSelect={selectClip}
              />
              {transcript && clips && clips.length > 0 && (
                <BatchStage
                  video={video}
                  clips={clips}
                  words={adjustedWords}
                  style={captionStyle}
                  resetToken={epoch}
                />
              )}
              <ReframeStage
                clip={selectedClip}
                state={reframeState}
                result={reframeResult}
                onRun={startReframe}
                onCancel={cancelReframe}
                onDismissError={() =>
                  setReframeState((s) => ({ ...s, phase: 'idle', error: null }))
                }
                onDeselect={() => selectClip(null)}
              />
              <RenderStage
                clip={selectedClip}
                words={adjustedWords}
                reframe={reframeResult}
                state={renderState}
                result={renderResult}
                style={captionStyle}
                onRun={startRender}
                onCancel={cancelRender}
                onDismissError={() =>
                  setRenderState((s) => ({ ...s, phase: 'idle', error: null }))
                }
                onDifferentClip={() => selectClip(null)}
              />
            </div>
          ) : (
            <div className="w-full max-w-2xl">
              <DropZone onOpenPicker={openPicker} onFile={selectFile} />
              <p className="mt-3 text-center text-xs text-zinc-600">
                Files stay on disk until you hit Transcribe — at that point audio is
                extracted in-memory and the original is never uploaded anywhere.
              </p>
            </div>
          )}
        </div>

        <div className="mt-10 flex items-center justify-center gap-2 text-[11px] text-zinc-600">
          <span
            className={`size-1.5 rounded-full ${video ? 'bg-emerald-400/70' : 'bg-zinc-700'}`}
          />
          {video ? `${video.name} · ${formatBytes(video.sizeBytes)}` : 'Waiting for a video'}
          {transcript && transcript.words.length > 0
            ? ` · ${transcript.words.length.toLocaleString()} words transcribed`
            : ''}
        </div>
      </main>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={handleInputChange}
      />

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onSaved={() => setEpoch((e) => e + 1)}
        />
      )}
    </div>
  )
}
